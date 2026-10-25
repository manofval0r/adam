# Shared Contracts Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `packages/contracts`, the single workspace package that owns Adam's normalized event schema, permission vocabulary, and connector contracts, so the daemon, relay, and web client stop maintaining parallel hand-written type definitions.

**Architecture:** One TypeScript package exporting Zod schemas plus the types inferred from them. The relay validates inbound payloads against these schemas at its trust boundary, the daemon serializes outbound events through them, and the web client parses with them. No app may define its own copy of a shared event or permission type.

**Tech Stack:** TypeScript 5.6, Zod 4.2, Vitest 2, npm workspaces

**Spec:** [Event schema](../../event-schema.md), [Adapter contract](../../adapter-contract.md), [Connector architecture](../../connector-architecture.md)

## Milestone mapping

This plan is deliberately split across two milestones, because the shared package is a prerequisite for the decision and permission gate rather than a parallel workstream.

| Task | Milestone | Why |
| --- | --- | --- |
| Task 1: Event envelope | Milestone 4 | The decision and permission events need a closed event type union to exist at all. |
| Task 2: Permission request and decision | Milestone 4 | Milestone 4's gate is defined in terms of these two schemas. |
| Task 3: Connector contracts | Milestone 6 | Nothing consumes connector manifests before the connector hub. |
| Task 4: Migrate the apps | Milestone 4, continuing into Milestone 6 | The app migration covers event and permission types in Milestone 4, and connector types in Milestone 6. |

## Global Constraints

- Node.js >= 20. TypeScript 5.6, Vitest 2, Zod 4.2. No other runtime dependency is permitted in this package.
- Zod is pinned to `^4.2.0` and declared once at the workspace root, so exactly one copy is hoisted. Zod 4.2 is the first release with `~standard.jsonSchema` self-conversion, and two copies of Zod in the dependency tree cause the TypeScript error TS2589. The MCP SDK v2 packages require Zod 4.2 and do not support Zod 3.
- The package name is `@adam/contracts`. It publishes only types and schemas, plus pure functions over them.
- `packages/*` may import from `packages/*` only. A package may never import from `apps/*`.
- Every schema that crosses a process boundary uses `.strict()`. Unknown keys are rejected, not stripped.
- Event types are a closed union. Adding a member is a breaking change to this package and requires updating every consumer in the same commit.
- Timestamps are ISO 8601 strings in UTC. They are validated for shape, never for clock accuracy.
- No schema may embed a credential, a token, a raw OAuth response, or a provider request body.
- Existing type files in the apps are replaced by re-exports of this package, not deleted, until every call site has migrated.

## Review Focus

These are the input classes and failure modes the specification implies but no task's tests exercise on its own. Each line is pinned by a test in the task that owns the relevant code.

1. An event arriving with an unrecognised `type` string, from a client on a newer build. The relay must reject it without crashing the ingest loop and without dropping later events in the same batch. Owned by Task 1 for the schema-level rejection. The batch and ingest behaviour is deferred: there is no daemon-to-relay event ingest endpoint today, so that requirement belongs to the milestone that adds event upload.
2. An event payload containing a user-controlled string that happens to look like a structural field name. User text in a prompt, repo path, or tool output must never be reinterpreted as schema structure. Owned by Task 1.
3. A device whose clock is wrong by hours or is set to a past date. Event ordering must not depend on a device-supplied timestamp. Owned by the cloud platform plan, whose Postgres store orders by ingestion sequence rather than by the device clock.
4. A connector manifest that declares a scope which is not justified by any capability it lists, or omits a capability that a granted scope implies. The manifest must fail validation. Owned by Task 3.
5. A permission decision arriving for a request that does not exist, or for a request that was already decided. The decision must be rejected rather than silently applied or ignored. Owned by Task 2.

---

### Task 1: Workspace package skeleton and event envelope

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/vitest.config.ts`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/events.ts`
- Create: `packages/contracts/test/events.test.ts`
- Modify: `package.json` (root, workspaces array)

**Interfaces:**
- Consumes: nothing. This task is the root of the shared dependency graph.
- Produces:
  - `SCHEMA_VERSION` — the constant `"2026-07-26"`.
  - `AdamEventType` — closed union of the sixteen event type strings listed in the event schema document.
  - `EventSourceKind` — union of `desktop_daemon`, `cloud_relay`, `web_client`, `mobile_client`, `adapter`, `github`, `ci`, `cloud_runner`.
  - `EventSource` — `{ kind: EventSourceKind; id?: string; name?: string; version?: string }`.
  - `EventActorKind` — union of `user`, `assistant`, `system`, `adapter`, `github`, `ci`.
  - `EventActor` — `{ kind: EventActorKind; id?: string; displayName?: string }`.
  - `EventVisibility` — union of `user_visible`, `collapsed`, `audit_only`, `hidden`.
  - `EventRetentionClass` — union of `ephemeral`, `standard`, `audit`, `artifact_pointer`.
  - `EventRetention` — `{ class: EventRetentionClass; ttlDays?: number }`.
  - `EventEnvelopeSchema` — strict Zod object validating the full envelope documented in the event schema.
  - `EventEnvelope` — inferred type of the above.
  - `parseEventEnvelope(input: unknown): EventEnvelope` — throws `ContractValidationError` on failure.
  - `ContractValidationError` — error class carrying `issues: string[]`.

- [ ] **Step 1: Wire the package into the workspace**

This step comes before the test, because the test command is `npm run test --workspace @adam/contracts` and that command cannot run until the workspace knows the package exists. Wiring first also means the red phase fails for the right reason.

Create `packages/contracts/package.json` with name `@adam/contracts`, `private: true`, `type: "module"`, a `main` pointing at `dist/index.js`, a `types` field pointing at `dist/index.d.ts`, an `exports` map whose `types` condition points at `dist/index.d.ts` and whose `import` condition points at `dist/index.js`, and scripts `build` running `tsc -p tsconfig.json` and `test` running `vitest run`. Add `"packages/*"` to the `workspaces` array in the root `package.json`, and add `zod` as a dependency of the root `package.json` so exactly one copy is hoisted for the whole workspace.

Add `contracts:test` and `contracts:build` scripts to the root `package.json`, matching the existing `daemon:test`, `relay:test`, and `web:test` naming, and include both in the root `ci` chain. The foundational package must be exercised by CI from the moment it exists, not from a later task.

Declare `zod` with the range `^4.2.0` in both the root `package.json` and `packages/contracts/package.json`. The ranges must be identical, so that npm hoists exactly one copy of Zod for the whole workspace. Two copies of Zod in the dependency tree cause the TypeScript error TS2589.

Run `npm install` after editing the root `package.json`, so that the workspace symlink for `@adam/contracts` exists.

Create `packages/contracts/tsconfig.json` extending the root base with `composite` enabled, `declaration` and `declarationMap` enabled, an `outDir` of `dist`, a `rootDir` of `src`, and `include` of `src`. Create `packages/contracts/vitest.config.ts` mirroring the existing app configs: `environment: "node"`, `include: ["test/**/*.test.ts"]`.

Do not add a path mapping for `@adam/contracts` to `tsconfig.base.json`. A path mapping would point the app compilers at the package source, which sits outside each app's `rootDir` of `src` and breaks the app build with a rootDir error. Resolution goes through the npm workspace symlink and the built `dist` output instead.

- [ ] **Step 2: Write the failing test**

Create `packages/contracts/test/events.test.ts` with these cases:

```ts
import { describe, expect, it } from "vitest";
import { EventEnvelopeSchema, parseEventEnvelope } from "../src/events.js";

const validEnvelope = {
  id: "evt_01",
  schemaVersion: "2026-07-26",
  type: "activity",
  sessionId: "ses_01",
  sequence: 12,
  createdAt: "2026-10-24T12:00:00.000Z",
  source: { kind: "desktop_daemon", id: "d_01", name: "studio", version: "0.1.0" },
  actor: { kind: "system", id: "a_01", displayName: "Codex" },
  payload: { title: "running tests" },
  visibility: "user_visible",
  retention: { class: "standard" },
};

describe("EventEnvelopeSchema", () => {
  it("accepts a well formed envelope", () => {
    expect(parseEventEnvelope(validEnvelope)).toMatchObject({ id: "evt_01", sequence: 12 });
  });

  it("rejects an unknown event type", () => {
    expect(() => parseEventEnvelope({ ...validEnvelope, type: "not_a_real_type" })).toThrow(
      /unknown event type/i,
    );
  });

  it("rejects a schema version it does not know", () => {
    expect(() => parseEventEnvelope({ ...validEnvelope, schemaVersion: "1999-01-01" })).toThrow();
  });

  it("rejects unknown top level keys", () => {
    expect(() => parseEventEnvelope({ ...validEnvelope, extra: true })).toThrow(/unrecognized/i);
  });

  it("rejects a payload that is not an object", () => {
    expect(() => parseEventEnvelope({ ...validEnvelope, payload: "text" })).toThrow();
  });

  it("accepts a payload containing user text that resembles a field name", () => {
    const envelope = {
      ...validEnvelope,
      payload: { title: "sequence: 999", body: "type: activity" },
    };
    expect(parseEventEnvelope(envelope).payload).toMatchObject({ title: "sequence: 999" });
  });

  it("rejects an unknown source kind", () => {
    expect(() => parseEventEnvelope({ ...validEnvelope, source: { kind: "toaster" } })).toThrow();
  });

  it("accepts a retention class without a ttl", () => {
    expect(parseEventEnvelope(validEnvelope).retention).toEqual({ class: "standard" });
  });

  it("rejects an unknown key inside a nested object", () => {
    expect(() => parseEventEnvelope({ ...validEnvelope, source: { kind: "desktop_daemon", surprise: true } })).toThrow(
      /unrecognized/i,
    );
  });

  it("accepts a zero offset utc timestamp", () => {
    expect(parseEventEnvelope({ ...validEnvelope, createdAt: "2026-10-24T12:00:00+00:00" }).createdAt).toBe(
      "2026-10-24T12:00:00+00:00",
    );
  });

  it("rejects a timestamp with a non-zero offset", () => {
    expect(() => parseEventEnvelope({ ...validEnvelope, createdAt: "2026-10-24T12:00:00+01:00" })).toThrow();
  });

  it("rejects a ttl of zero days", () => {
    expect(() => parseEventEnvelope({ ...validEnvelope, retention: { class: "standard", ttlDays: 0 } })).toThrow();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test --workspace @adam/contracts`
Expected: FAIL with a module-not-found error for `../src/events.js`.

- [ ] **Step 4: Implement the event envelope schema in `packages/contracts/src/events.ts`**

Export `SCHEMA_VERSION` as the constant `"2026-07-26"`.

Export `AdamEventType` as a closed union of exactly the sixteen event type strings in the event schema document: `session_started`, `message`, `activity`, `tool_call`, `permission_request`, `permission_decision`, `decision_request`, `decision_response`, `file_change`, `diff`, `artifact`, `git_event`, `ci_event`, `prompt_delivery`, `error`, `session_ended`.

Export `EventSourceKind`, `EventActorKind`, `EventVisibility`, and `EventRetentionClass` as the unions listed in the Interfaces block.

Export `EventSourceSchema` and `EventActorSchema` as strict objects with the optional identifier fields the schema documents. The source schema allows `kind`, `id`, `name`, and `version`; the actor schema allows `kind`, `id`, and `displayName`.

Export `EventRetentionSchema` as a strict object with a required `class` and an optional `ttlDays` that must be a positive integer when present.

Export `EventEnvelopeSchema` as a strict Zod object with these fields:

- `id`: string, minimum 1 character
- `schemaVersion`: the literal `SCHEMA_VERSION`
- `type`: the `AdamEventType` union
- `sessionId`: string, minimum 1 character
- `sequence`: integer, minimum 0
- `createdAt`: string matching an ISO 8601 UTC pattern, validated for shape only. The pattern must accept both the `Z` designator and a zero numeric offset such as `+00:00`, because both are UTC. It must reject a non-zero offset such as `+01:00`, because a non-zero offset is not a UTC timestamp. The rule is shape, never clock accuracy: a well-formed timestamp from a device with a wrong clock still validates.
- `source`: `EventSourceSchema`
- `actor`: `EventActorSchema`
- `correlationId`: optional string, minimum 1 character
- `parentEventId`: optional string, minimum 1 character
- `payload`: `z.record(z.string(), z.unknown())`
- `visibility`: the `EventVisibility` union
- `retention`: `EventRetentionSchema`

Export `parseEventEnvelope` that calls `EventEnvelopeSchema.safeParse`, and on failure throws `ContractValidationError` whose message includes the failing field paths joined by `, `, and whose `issues` array holds one string per issue. Export `ContractValidationError` from the same module.

The schema must not inspect the contents of `payload` beyond requiring an object, so that user text inside a payload can never be interpreted as structure.

Create `packages/contracts/src/index.ts` re-exporting everything from `./events.js`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test --workspace @adam/contracts`
Expected: PASS, 13 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts package.json package-lock.json
git commit -m "feat(contracts): add shared event envelope schema package"
```

---

### Task 2: Permission and decision schemas

**Files:**
- Create: `packages/contracts/src/permission.ts`
- Create: `packages/contracts/test/permission.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `AdamEventType` and `EventEnvelopeSchema` from `packages/contracts/src/events.ts`.
- Produces:
  - `RiskTier` — union of `"green" | "yellow" | "red"`.
  - `PermissionRequestSchema` — Zod object for `{ requestId, sessionId, subject, capability, riskTier, summary, details, requestedAt }`.
  - `PermissionDecisionSchema` — Zod object for `{ requestId, decision, decidedBy, decidedAt, reason }` where `decision` is `"approved" | "denied"`.
  - `PermissionRequest` and `PermissionDecision` inferred types.
  - `parsePermissionRequest(input: unknown): PermissionRequest`
  - `parsePermissionDecision(input: unknown): PermissionDecision`
  - `applyDecision(requests: PermissionRequest[], decision: PermissionDecision): PermissionRequest[]` — returns the requests with the matching `requestId` replaced by one carrying the decision, and throws `ContractValidationError` when no matching request exists.

- [ ] **Step 1: Write the failing test**

Create `packages/contracts/test/permission.test.ts` covering these behaviours:

```ts
it("rejects a decision for an unknown request", () => {
  expect(() => applyDecision([], decisionFor("req_missing"))).toThrow(/no matching permission request/i);
});

it("rejects a second decision for an already decided request", () => {
  const decided = applyDecision([request], decisionFor("req_01"));
  expect(() => applyDecision(decided, decisionFor("req_01"))).toThrow(/already decided/i);
});

it("records the decision against the matching request", () => {
  const result = applyDecision([request], decisionFor("req_01"));
  expect(result[0]).toMatchObject({ requestId: "req_01", decision: "approved" });
});

it("rejects a decision whose requestId is empty", () => {
  expect(() => parsePermissionDecision({ ...validDecision, requestId: "" })).toThrow();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace @adam/contracts`
Expected: FAIL with a module-not-found error for `../src/permission.js`.

- [ ] **Step 3: Implement the permission schemas in `packages/contracts/src/permission.ts`**

Define `RiskTier` as the three-value union. Define `PermissionRequestSchema` as a strict object where `requestId` and `sessionId` are non-empty strings, `subject` identifies what is being requested, `capability` is a non-empty string, `riskTier` is the `RiskTier` union, `summary` is a non-empty string, `details` is an optional record, and `requestedAt` is an ISO 8601 UTC string.

Define `PermissionDecisionSchema` as a strict object where `requestId` is a non-empty string, `decision` is the two-value union, `decidedBy` is a non-empty string identifying the deciding principal, `decidedAt` is an ISO 8601 UTC string, and `reason` is optional.

Implement `applyDecision` so that it finds the request whose `requestId` matches. When no request matches, throw `ContractValidationError` with a message containing `no matching permission request`. When a matching request already carries a `decision`, throw with a message containing `already decided`. Otherwise return a new array with that request replaced by the request's fields plus the decision fields.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace @adam/contracts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): add permission request and decision schemas"
```

---

### Task 3: Connector contracts

**Files:**
- Create: `packages/contracts/src/connector.ts`
- Create: `packages/contracts/test/connector.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `RiskTier` from `packages/contracts/src/permission.ts`, `EventEnvelopeSchema` from `packages/contracts/src/events.ts`.
- Produces:
  - `ConnectorAuthKind` — union of `"oauth2_pkce" | "api_key" | "personal_access_token"`.
  - `ConnectorManifestSchema` — strict object for `{ id, displayName, version, riskTier, authKind, capabilities, scopes, scopeRequirements, instructions }`.
  - `ConnectorCapabilitiesSchema` — strict object for `{ read: string[], write: string[], notify: string[] }`.
  - `scopeRequirements` — a map from an OAuth scope string to the capability that justifies it. Every entry in `scopes` must appear as a key, and every referenced capability must be declared in one of the capability lists.
  - `ConnectorConnectionStatus` — union of `"pending" | "active" | "expired" | "revoked"`.
  - `ConnectorConnectionSchema` — strict object for `{ connectionId, providerId, status, scopes, grantedAt, expiresAt }`.
  - `ConnectorActionEventSchema` and `ConnectorConnectionEventSchema` — strict event payload schemas.
  - `ConnectorManifest`, `ConnectorCapabilities`, `ConnectorConnection`, `ConnectorActionEvent`, `ConnectorConnectionEvent` inferred types.
  - `parseConnectorManifest(input: unknown): ConnectorManifest`
  - `parseConnectorConnection(input: unknown): ConnectorConnection`
  - `effectiveRiskTier(manifest: ConnectorManifest, capability: string): RiskTier` — returns the stricter of the manifest tier and the tier implied by the capability's membership in `capabilities.read`, `capabilities.write`, or `capabilities.notify`. A capability that appears in `write` is at least yellow. A capability in no list throws `ContractValidationError`.

- [ ] **Step 1: Write the failing test**

Create `packages/contracts/test/connector.test.ts` covering these behaviours:

```ts
it("rejects a manifest with an unknown top level key", () => {
  expect(() => parseConnectorManifest({ ...validManifest, sneaky: true })).toThrow(/unrecognized/i);
});

it("rejects a manifest whose capabilities are not arrays of strings", () => {
  expect(() => parseConnectorManifest({ ...validManifest, capabilities: { read: "message.list" } })).toThrow();
});

it("rejects a manifest with a duplicate capability across lists", () => {
  expect(() => parseConnectorManifest({
    ...validManifest,
    capabilities: { read: ["message.list"], write: ["message.list"], notify: [] },
  })).toThrow(/duplicate capability/i);
});

it("throws for a capability that is not declared by the manifest", () => {
  expect(() => effectiveRiskTier(validManifest, "message.delete")).toThrow(/not declared/i);
});

it("treats a write capability as at least yellow", () => {
  expect(effectiveRiskTier(validManifest, "message.send")).toBe("yellow");
});

it("treats a read capability as green", () => {
  expect(effectiveRiskTier(validManifest, "message.list")).toBe("green");
});

it("returns the stricter of the manifest tier and the capability tier", () => {
  const redManifest = { ...validManifest, riskTier: "red" as const };
  expect(effectiveRiskTier(redManifest, "message.list")).toBe("red");
});

it("rejects a scope that no declared capability justifies", () => {
  expect(() => parseConnectorManifest({
    ...validManifest,
    scopes: ["gmail.modify"],
    scopeRequirements: { "gmail.readonly": "message.list" },
  })).toThrow(/scope/i);
});

it("rejects a scope requirement naming a capability the manifest does not declare", () => {
  expect(() => parseConnectorManifest({
    ...validManifest,
    scopeRequirements: { "gmail.send": "message.send" },
  })).toThrow(/capability/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace @adam/contracts`
Expected: FAIL with a module-not-found error for `../src/connector.js`.

- [ ] **Step 3: Implement the connector contracts in `packages/contracts/src/connector.ts`**

Define the unions and schemas described in the Interfaces block. The manifest schema is strict, requires `id`, `displayName`, `version`, `riskTier`, `authKind`, and `capabilities`, and allows `scopes` to default to an empty array and `instructions` to be optional.

The manifest schema must additionally reject a manifest whose capability lists contain the same string in more than one list. Implement that as a `superRefine` on `ConnectorCapabilitiesSchema` producing an issue whose message contains `duplicate capability`.

Implement `effectiveRiskTier` so that a capability found only in `capabilities.read` yields `"green"`, a capability found in `capabilities.write` or `capabilities.notify` yields `"yellow"`, and the final result is whichever of that and `manifest.riskTier` is stricter, with `green` < `yellow` < `red`. A capability found in no list throws `ContractValidationError` with a message containing `not declared`.

Define `ConnectorActionEventSchema` with fields `connectionId`, `providerId`, `capability`, `riskTier`, `outcome` (one of `started`, `completed`, `failed`, `denied`), `durationMs`, `argumentDigest`, `resultDigest`, and `summary`. Define `ConnectorConnectionEventSchema` with fields `connectionId`, `providerId`, `status` (one of `connected`, `disconnected`, `expired`, `revoked`), and `occurredAt`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace @adam/contracts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): add connector manifest, connection, and event schemas"
```

---

### Task 4: Migrate the apps onto the shared package

**Files:**
- Modify: `apps/daemon/src/types.ts`
- Modify: `apps/relay/src/types.ts`
- Modify: `apps/daemon/src/event-log.ts`
- Modify: `apps/relay/src/server.ts`
- Modify: `apps/daemon/package.json`
- Modify: `apps/relay/package.json`
- Modify: `apps/web/package.json`
- Modify: `apps/daemon/vitest.config.ts`
- Modify: `apps/relay/vitest.config.ts`
- Modify: `apps/web/vitest.config.ts`
- Create: `apps/daemon/test/contracts.test.ts`
- Create: `apps/daemon/test/event-log.test.ts`
- Create: `apps/relay/test/contracts.test.ts`

**Interfaces:**
- Consumes: everything exported by `@adam/contracts`.
- Produces: no new public interface. The apps' existing type names remain importable from their existing paths, now backed by the shared package.

- [ ] **Step 1: Write the failing test**

Create `apps/daemon/test/contracts.test.ts` asserting that the daemon's event types are identical to the shared package's:

```ts
import { describe, expect, it } from "vitest";
import { AdamEventType } from "@adam/contracts";
import { DaemonEventType } from "../src/types.js";

describe("shared contracts", () => {
  it("uses the shared event type union in the daemon", () => {
    expect(DaemonEventType).toBe(AdamEventType);
  });
});
```

Create `apps/relay/test/contracts.test.ts` asserting that every event the relay emits satisfies the shared schema:

```ts
import { describe, expect, it } from "vitest";
import { EventEnvelopeSchema } from "@adam/contracts";

describe("relay event conformance", () => {
  it("emits events that satisfy the shared envelope schema", async () => {
    await submitPromptViaRelay(app, authHeaders);
    const response = await app.inject({ method: "GET", url: "/v1/events", headers: authHeaders });
    const events = response.json().events;
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(EventEnvelopeSchema.safeParse(event).success).toBe(true);
    }
  });
});
```

The relay currently has no daemon-side event ingest endpoint, so this asserts the property that is actually reachable today: the events the relay produces are valid shared envelopes.

Create `apps/daemon/test/event-log.test.ts` asserting the same property for the daemon's local event log:

```ts
import { describe, expect, it } from "vitest";
import { EventEnvelopeSchema } from "@adam/contracts";

describe("daemon event log conformance", () => {
  it("writes events that satisfy the shared envelope schema", async () => {
    const log = await writeSampleEvents();
    for (const line of readLogLines(log)) {
      expect(EventEnvelopeSchema.safeParse(JSON.parse(line)).success).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace @adam/daemon`
Expected: FAIL because the daemon does not yet depend on `@adam/contracts`.

- [ ] **Step 3: Re-export shared types from the app type modules**

In `apps/daemon/src/types.ts`, replace the hand-written event type union with a re-export from `@adam/contracts`, keeping the existing export names so call sites do not change. Keep any daemon-local types that are genuinely local to the daemon.

In `apps/relay/src/types.ts`, do the same for the event and permission types.

In `apps/daemon/src/event-log.ts` and `apps/relay/src/server.ts`, replace local construction and validation of event envelopes with `parseEventEnvelope` from `@adam/contracts`. The relay has no event ingest endpoint today, so the migration here is about the events the relay itself constructs, not about validating an inbound body.

Add `"@adam/contracts": "*"` to the dependencies of `apps/daemon/package.json`, `apps/relay/package.json`, and `apps/web/package.json`.

Make the package resolve in both test and build, without a path mapping:

- In each app's `vitest.config.ts`, add a resolve alias mapping `@adam/contracts` to the package source, so a test run never depends on a built or up-to-date `dist`. Use the same alias value in all three apps.
- In each app's `package.json`, add a `prebuild` script that runs `npm run build --workspace @adam/contracts`, so a standalone app build always has the package's declarations available. npm runs `prebuild` automatically before `build`.
- In the root `package.json`, put the contracts build before the app builds in the `ci` script.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace @adam/daemon`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm run ci`
Expected: PASS, with the docs check, all workspace tests, and all builds green.

- [ ] **Step 6: Commit**

```bash
git add apps packages/contracts package-lock.json
git commit -m "refactor: route daemon and relay types through shared contracts package"
```
