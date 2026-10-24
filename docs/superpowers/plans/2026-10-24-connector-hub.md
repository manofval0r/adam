# Connector Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the connector hub so a user can connect an external account once, and then use that capability from the agent running on their computer through MCP and from the phone through the relay API, with every call scoped, permission-checked, and audited.

**Architecture:** The relay owns connector credentials, encrypted at rest with envelope encryption, and executes the provider call itself. All surfaces converge on one executor that applies the same scope check, the same permission gate, and the same audit record regardless of who asked. The agent-facing surface is an MCP server over Streamable HTTP in stateless mode; the phone-facing surface is a REST invoke endpoint reusing the existing device-token auth.

**Tech Stack:** Node.js 20, TypeScript 5.6, Fastify 4, Zod 4.2, the Model Context Protocol TypeScript SDK v2, `pg` 8, Vitest 2

**Spec:** [Connector architecture](../../connector-architecture.md)

**Depends on:** [Shared contracts plan](2026-10-24-shared-contracts.md), [Cloud platform plan](2026-10-24-cloud-platform.md)

## Global Constraints

- The agent never receives a provider credential. The only credential the agent holds is an Adam-scoped bearer token bound to a single connection.
- A connector's grant is fixed at connection time and can only be narrowed afterwards, never widened. The executor checks the grant before the risk tier, and the scope check is absolute.
- Provider credentials are encrypted with envelope encryption and are never written to a log, an event, an error message, or an audit record.
- Every connector action produces exactly one `connector_action` event and one audit record, including denied and failed actions.
- A refresh failure that indicates the grant is gone moves the connection to `expired` and blocks further use. The relay never retries a dead grant and never falls back to a cached access token.
- The relay executes the call. Connector implementations that need the user's machine are adapter concerns, not connector concerns.
- The MCP endpoint is stateless. No MCP session state is held in process memory or in the database.
- The only new runtime dependency is the Model Context Protocol TypeScript SDK, which is MIT licensed.
- Red-tier capabilities require an explicit approval through the existing permission request and decision flow. There is no second approval mechanism.

## Review Focus

1. A prompt injection arriving through an agent transcript that tries to widen a connector's scope, or to call a capability the grant does not cover. The call must be refused, audited as denied, and must not reach the provider.
2. A refresh token that Google has revoked, which happens when the user changes their password, revokes access in their account settings, or when a seven-day testing-mode token expires. The connection must go to `expired` and notify the phone rather than silently retrying or serving stale data.
3. A connector that returns an error body containing part of the request, such as an echoed token. The stored audit record must contain the provider status code and a redacted body, never the raw body.
4. The same capability invoked from the phone and from the agent. Both must produce the same permission decision, the same audit shape, and the same event, so the audit trail cannot be bypassed by choosing a different client.
5. A connection that is revoked while an action is in flight. The in-flight action must complete or fail on its own terms, but no subsequent action may use the connection.

---

### Task 1: Credential vault

**Files:**
- Create: `apps/relay/src/connectors/credentials.ts`
- Create: `apps/relay/test/credentials.test.ts`

**Interfaces:**
- Consumes: nothing beyond Node's `crypto` module.
- Produces:
  - `encryptCredential(plaintext: string, connectionId: string, masterKey: Buffer): EncryptedCredential` — returns `{ ciphertext, wrappedKey, iv, tag }`, all base64.
  - `decryptCredential(record: EncryptedCredential, connectionId: string, masterKey: Buffer): string` — throws when the connection identifier does not match the additional authenticated data.
  - `rotateMasterKey(records: EncryptedCredential[], connectionIds: string[], oldKey: Buffer, newKey: Buffer): EncryptedCredential[]` — returns new records with the data key re-wrapped and the payload re-encrypted under the new master key.
  - `EncryptedCredential` — `{ ciphertext: string; wrappedKey: string; iv: string; tag: string }`.
  - `CredentialVaultError` — error class for a failed unwrap or a mismatched connection identifier.

- [ ] **Step 1: Write the failing test**

Create `apps/relay/test/credentials.test.ts`:

```ts
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptCredential, encryptCredential, rotateMasterKey } from "../src/connectors/credentials.js";

const masterKey = randomBytes(32);
const otherMasterKey = randomBytes(32);

describe("credential vault", () => {
  it("round trips a credential", () => {
    const record = encryptCredential("refresh-token-value", "conn_01", masterKey);
    expect(decryptCredential(record, "conn_01", masterKey)).toBe("refresh-token-value");
  });

  it("never stores the plaintext in the record", () => {
    const record = encryptCredential("refresh-token-value", "conn_01", masterKey);
    expect(JSON.stringify(record)).not.toContain("refresh-token-value");
  });

  it("refuses to decrypt under a different connection id", () => {
    const record = encryptCredential("refresh-token-value", "conn_01", masterKey);
    expect(() => decryptCredential(record, "conn_02", masterKey)).toThrow(/connection/i);
  });

  it("refuses to decrypt under the wrong master key", () => {
    const record = encryptCredential("refresh-token-value", "conn_01", masterKey);
    expect(() => decryptCredential(record, "conn_01", otherMasterKey)).toThrow();
  });

  it("produces a different ciphertext each time", () => {
    const a = encryptCredential("same", "conn_01", masterKey);
    const b = encryptCredential("same", "conn_01", masterKey);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("rotates the master key without changing the plaintext", () => {
    const record = encryptCredential("refresh-token-value", "conn_01", masterKey);
    const rotated = rotateMasterKey([record], ["conn_01"], masterKey, otherMasterKey);
    expect(decryptCredential(rotated[0], "conn_01", otherMasterKey)).toBe("refresh-token-value");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace @adam/relay`
Expected: FAIL with a module-not-found error for `../src/connectors/credentials.js`.

- [ ] **Step 3: Implement the vault**

Create `apps/relay/src/connectors/credentials.ts`.

`encryptCredential` generates a random 32-byte data key, generates a random 12-byte IV, and encrypts the plaintext with AES-256-GCM using the data key. The additional authenticated data is the connection identifier. It then wraps the data key with the master key using AES-256-GCM with a second random IV and the connection identifier as additional authenticated data. It returns the four base64 strings.

`decryptCredential` reverses this. It unwraps the data key, then decrypts the ciphertext, and throws `CredentialVaultError` when the additional authenticated data does not match, when the authentication tag fails, or when the master key is wrong. The error message never includes the ciphertext, the key material, or the plaintext.

`rotateMasterKey` takes the existing records and their connection identifiers and returns new records encrypted under the new master key. It performs the unwrap and re-wrap in memory and never writes to disk.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace @adam/relay`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/relay
git commit -m "feat(relay): add envelope-encrypted credential vault with key rotation"
```

---

### Task 2: Connector registry and manifest validation

**Files:**
- Create: `apps/relay/src/connectors/types.ts`
- Create: `apps/relay/src/connectors/registry.ts`
- Create: `apps/relay/test/registry.test.ts`

**Interfaces:**
- Consumes: `ConnectorManifest`, `ConnectorCapabilities`, `RiskTier`, `effectiveRiskTier`, and `parseConnectorManifest` from `@adam/contracts`.
- Produces:
  - `Connector` — an interface with `manifest: ConnectorManifest`, `authorize(context): Promise<ConnectorAuthorization>`, `refresh(context): Promise<ConnectorAuthorization | null>`, `revoke(context): Promise<void>`, `invoke(context): Promise<ConnectorResult>`, and `health(context): Promise<ConnectorHealth>`.
  - `ConnectorHealth` — `{ status: "healthy" | "degraded" | "unavailable"; checkedAt: string; message?: string }`.
  - `ConnectorAuthorization` — `{ accessToken: string; refreshToken?: string; expiresAt?: string; scopes: string[] }`.
  - `ConnectorInvokeContext` — `{ connectionId: string; capability: string; arguments: Record<string, unknown>; signal: AbortSignal }`.
  - `ConnectorResult` — `{ data: unknown; summary: string }`.
  - `ConnectorRegistry` — a class with `register(connector: Connector): void`, `get(providerId: string): Connector` which throws when the provider is unknown, and `list(): ConnectorManifest[]`.
  - `ConnectorRegistryError` — error class for an unknown provider.

- [ ] **Step 1: Write the failing test**

Create `apps/relay/test/registry.test.ts`:

```ts
it("throws for an unknown provider", () => {
  expect(() => registry.get("nope")).toThrow(/unknown provider/i);
});

it("rejects a manifest that fails validation", () => {
  expect(() => registry.register({ ...fakeConnector, manifest: { ...fakeConnector.manifest, riskTier: "purple" } })).toThrow();
});

it("rejects a second connector for the same provider", () => {
  registry.register(fakeConnector);
  expect(() => registry.register(fakeConnector)).toThrow(/already registered/i);
});

it("lists the registered manifests", () => {
  registry.register(fakeConnector);
  expect(registry.list().map((m) => m.id)).toContain("fake");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace @adam/relay`
Expected: FAIL with a module-not-found error for `../src/connectors/registry.js`.

- [ ] **Step 3: Implement the registry**

Create `apps/relay/src/connectors/types.ts` with the `Connector`, `ConnectorAuthorization`, `ConnectorInvokeContext`, and `ConnectorResult` types described above.

Create `apps/relay/src/connectors/registry.ts` with the `ConnectorRegistry` class. `register` validates the manifest with `parseConnectorManifest` before storing, so an invalid manifest throws before it can be registered. It throws when a connector with the same provider identifier is already registered. `get` throws `ConnectorRegistryError` with a message containing `unknown provider`. `list` returns the manifests.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace @adam/relay`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/relay
git commit -m "feat(relay): add connector registry with manifest validation"
```

---

### Task 3: Connection store and credential lifecycle

**Files:**
- Create: `apps/relay/src/connectors/store.ts`
- Create: `apps/relay/test/connection-store.test.ts`
- Create: `apps/relay/src/db/migrations/0002_connectors.sql`

**Interfaces:**
- Consumes: `encryptCredential` and `decryptCredential` from `apps/relay/src/connectors/credentials.ts`, the shared connector contracts from `@adam/contracts`, and the `Pool` from `apps/relay/src/db/pool.ts`.
- Produces:
  - `ConnectorConnectionStore` — a class with `create(userId, providerId, authorization, scopes): Promise<StoredConnection>`, `get(connectionId): Promise<StoredConnection | null>`, `listForUser(userId): Promise<StoredConnection[]>`, `updateAuthorization(connectionId, authorization): Promise<StoredConnection>`, `markExpired(connectionId): Promise<void>`, `revoke(connectionId): Promise<void>`, and `deleteCredential(connectionId): Promise<void>`.
  - `StoredConnection` — `{ connectionId, userId, providerId, status, scopes, credential: EncryptedCredential | null, grantedAt, expiresAt }`.
  - `ConnectorConnectionStoreError` — error class for a missing connection.

- [ ] **Step 1: Write the failing test**

Create `apps/relay/test/connection-store.test.ts`:

```ts
it("stores an encrypted credential and never the plaintext", async () => {
  const connection = await store.create(userId, "gmail", auth, ["gmail.send"]);
  const row = await readRowDirectly(connection.connectionId);
  expect(JSON.stringify(row)).not.toContain("refresh-token-value");
});

it("round trips the credential through the vault", async () => {
  const created = await store.create(userId, "gmail", auth, ["gmail.send"]);
  const loaded = await store.get(created.connectionId);
  expect(decryptCredential(loaded!.credential!, created.connectionId, masterKey)).toBe("refresh-token-value");
});

it("moves a connection to expired and blocks use", async () => {
  const created = await store.create(userId, "gmail", auth, ["gmail.send"]);
  await store.markExpired(created.connectionId);
  const loaded = await store.get(created.connectionId);
  expect(loaded!.status).toBe("expired");
});

it("removes the credential on revoke", async () => {
  const created = await store.create(userId, "gmail", auth, ["gmail.send"]);
  await store.revoke(created.connectionId);
  const loaded = await store.get(created.connectionId);
  expect(loaded!.credential).toBeNull();
});
```

The test skips itself with a clear message when no test database URL is configured.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace @adam/relay`
Expected: FAIL with a module-not-found error for `../src/connectors/store.js`.

- [ ] **Step 3: Implement the store and the migration**

Create `apps/relay/src/db/migrations/0002_connectors.sql` defining a `connector_connections` table with columns for `connection_id`, `user_id`, `provider_id`, `status`, `scopes` as a text array, `ciphertext`, `wrapped_key`, `iv`, `tag`, `granted_at`, `expires_at`, `created_at`, and `updated_at`. Add a `retention_class` column defaulting to `standard`. Add an index on `(user_id, provider_id)` and a unique index on `connection_id`.

Create `apps/relay/src/connectors/store.ts` with the `ConnectorConnectionStore` class. Every credential write passes through `encryptCredential` with the connection identifier as additional authenticated data. `markExpired` sets the status and clears the expiry. `revoke` sets the status, clears the credential columns, and records the revocation timestamp. `deleteCredential` nulls the credential columns while leaving the row and its audit history intact.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace @adam/relay`
Expected: PASS when a test database URL is configured, and SKIPPED otherwise.

- [ ] **Step 5: Commit**

```bash
git add apps/relay
git commit -m "feat(relay): add encrypted connector connection store with lifecycle states"
```

---

### Task 4: Connector executor with scope, permission, and audit

**Files:**
- Create: `apps/relay/src/connectors/executor.ts`
- Create: `apps/relay/src/connectors/audit.ts`
- Create: `apps/relay/test/executor.test.ts`

**Interfaces:**
- Consumes: `ConnectorRegistry` from `apps/relay/src/connectors/registry.ts`, `ConnectorConnectionStore` from `apps/relay/src/connectors/store.ts`, `effectiveRiskTier` and the permission contracts from `@adam/contracts`.
- Produces:
  - `ConnectorExecutor` — a class with `invoke(input: ConnectorInvokeInput): Promise<ConnectorInvocationResult>`.
  - `ConnectorInvokeInput` — `{ connectionId: string; capability: string; arguments: Record<string, unknown>; actor: ConnectorActor }` where `ConnectorActor` is `{ kind: "phone" | "agent" | "web"; principalId: string }`.
  - `ConnectorInvocationResult` — `{ outcome: "completed" | "failed" | "denied"; data?: unknown; summary: string; eventId: string }`.
  - `ConnectorDeniedError` — error class carrying `reason: "not_granted" | "unknown_capability" | "connection_not_active" | "approval_required"`.
  - `digestArguments(value: unknown): string` — returns the base64 SHA-256 of the canonicalized value.
  - `redactText(value: string): string` — removes anything that looks like a bearer token or an email address from free-text output.

- [ ] **Step 1: Write the failing test**

Create `apps/relay/test/executor.test.ts`:

```ts
it("refuses a capability that the grant does not cover", async () => {
  const result = await executor.invoke({ connectionId, capability: "message.delete", arguments: {}, actor });
  expect(result.outcome).toBe("denied");
  expect(providerCallCount).toBe(0);
});

it("refuses a capability the manifest does not declare", async () => {
  const result = await executor.invoke({ connectionId, capability: "not.a.capability", arguments: {}, actor });
  expect(result.outcome).toBe("denied");
});

it("refuses to use an expired connection", async () => {
  await store.markExpired(connectionId);
  const result = await executor.invoke({ connectionId, capability: "message.send", arguments: {}, actor });
  expect(result.outcome).toBe("denied");
});

it("records a denied action in the audit trail", async () => {
  await executor.invoke({ connectionId, capability: "message.delete", arguments: {}, actor });
  const entries = await readAuditEntries(connectionId);
  expect(entries[0].outcome).toBe("denied");
});

it("records the actor so phone and agent paths are indistinguishable in the audit", async () => {
  await executor.invoke({ connectionId, capability: "message.send", arguments: {}, actor: { kind: "phone", principalId: "u1" } });
  await executor.invoke({ connectionId, capability: "message.send", arguments: {}, actor: { kind: "agent", principalId: "u1" } });
  const entries = await readAuditEntries(connectionId);
  expect(entries).toHaveLength(2);
  expect(entries[0].outcome).toBe("completed");
  expect(entries[1].outcome).toBe("completed");
});

it("does not store raw provider arguments containing a token", async () => {
  await executor.invoke({ connectionId, capability: "message.send", arguments: { body: "Bearer sk-secret" }, actor });
  const entries = await readAuditEntries(connectionId);
  expect(JSON.stringify(entries)).not.toContain("sk-secret");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace @adam/relay`
Expected: FAIL with a module-not-found error for `../src/connectors/executor.js`.

- [ ] **Step 3: Implement the executor and the audit writer**

Create `apps/relay/src/connectors/audit.ts` with `digestArguments` and `redactText`. `digestArguments` canonicalizes the value by sorting object keys recursively, then returns the base64 SHA-256 digest. `redactText` replaces anything matching a bearer-token pattern with a redaction marker, and replaces email addresses with a masked form.

Create `apps/relay/src/connectors/executor.ts` with the `ConnectorExecutor` class. `invoke` performs these steps in order, and stops at the first failure:

1. Load the connection. If it is missing, or its status is not `active`, deny with `connection_not_active`.
2. Load the connector from the registry. If the provider is unknown, deny with `unknown_capability`.
3. Check the capability against the manifest using `effectiveRiskTier`. If the manifest does not declare it, deny with `unknown_capability`.
4. Check the capability against the granted scopes. If the grant does not cover it, deny with `not_granted`.
5. Determine the effective risk tier. If it is red, request approval through the existing permission flow and deny with `approval_required` until a matching approval exists.
6. Call the connector, capture the outcome and duration, and redact the summary.
7. Write the audit record and the `connector_action` event. The event carries the argument digest and the result digest, never the raw arguments.

Every denial at steps 1 to 5 writes an audit record and an event with outcome `denied`, and never calls the provider.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace @adam/relay`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/relay
git commit -m "feat(relay): add connector executor with scope, permission, and audit"
```

---

### Task 5: Relay REST surface for connections

**Files:**
- Create: `apps/relay/src/routes/connectors.ts`
- Create: `apps/relay/test/connectors-routes.test.ts`
- Modify: `apps/relay/src/server.ts`

**Interfaces:**
- Consumes: `ConnectorRegistry`, `ConnectorConnectionStore`, and `ConnectorExecutor` from `apps/relay/src/connectors/`.
- Produces: four routes registered on the relay's existing authenticated route group.
  - `GET /v1/connectors` — lists the connectors the current user may use, with their manifests.
  - `POST /v1/connectors/connect` — body `{ providerId, authorization }`, creates a connection, returns `{ connectionId, status, scopes }`.
  - `POST /v1/connectors/:connectionId/invoke` — body `{ capability, arguments }`, returns the `ConnectorInvocationResult`.
  - `DELETE /v1/connectors/:connectionId` — revokes the connection and deletes its credential.

- [ ] **Step 1: Write the failing test**

Create `apps/relay/test/connectors-routes.test.ts`:

```ts
it("rejects an invoke for a connection belonging to another user", async () => {
  const response = await app.inject({ method: "POST", url: `/v1/connectors/${otherUserConnectionId}/invoke`, payload: { capability: "message.send", arguments: {} }, headers: authHeaders });
  expect(response.statusCode).toBe(404);
});

it("rejects an unauthenticated invoke", async () => {
  const response = await app.inject({ method: "POST", url: `/v1/connectors/${connectionId}/invoke`, payload: { capability: "message.send", arguments: {} } });
  expect(response.statusCode).toBe(401);
});

it("returns 403 when the capability is not granted", async () => {
  const response = await app.inject({ method: "POST", url: `/v1/connectors/${connectionId}/invoke`, payload: { capability: "message.delete", arguments: {} }, headers: authHeaders });
  expect(response.statusCode).toBe(403);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace @adam/relay`
Expected: FAIL with a 404 for the unregistered route.

- [ ] **Step 3: Implement the routes**

Create `apps/relay/src/routes/connectors.ts` exporting `registerConnectorRoutes(app, deps)` where `deps` carries the registry, the connection store, and the executor.

Every route resolves the caller through the relay's existing device-token authentication. A connection belonging to a different user must be reported as not found rather than forbidden, so the endpoint does not confirm the existence of another user's connection.

The invoke route maps the executor's denial reasons onto status codes: `not_granted` and `unknown_capability` return 403, `connection_not_active` returns 409, and `approval_required` returns 428 with a reference to the pending permission request.

Modify `apps/relay/src/server.ts` to register the routes.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace @adam/relay`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/relay
git commit -m "feat(relay): add connector connection and invoke routes"
```

---

### Task 6: MCP endpoint over Streamable HTTP

**Files:**
- Create: `apps/relay/src/mcp/server.ts`
- Create: `apps/relay/src/mcp/tools.ts`
- Create: `apps/relay/src/routes/mcp.ts`
- Create: `apps/relay/test/mcp.test.ts`
- Modify: `apps/relay/package.json`

**Interfaces:**
- Consumes: `ConnectorRegistry` and `ConnectorExecutor` from `apps/relay/src/connectors/`.
- Produces:
  - `createMcpServer(deps): McpServer` — an MCP server whose tools are derived from the registered connector manifests.
  - `registerMcpRoutes(app, deps)` — registers `POST /mcp`, `GET /mcp`, and `GET /.well-known/oauth-protected-resource`.
  - `buildProtectedResourceMetadata(issuer: string): object` — the RFC 9728 document listing `authorization_servers`, `bearer_methods_supported`, and `scopes_supported`.

- [ ] **Step 1: Write the failing test**

Create `apps/relay/test/mcp.test.ts`:

```ts
it("returns 401 with a resource metadata pointer when no token is presented", async () => {
  const response = await app.inject({ method: "POST", url: "/mcp", payload: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  expect(response.statusCode).toBe(401);
  expect(response.headers["www-authenticate"]).toContain("resource_metadata");
});

it("serves protected resource metadata", async () => {
  const response = await app.inject({ method: "GET", url: "/.well-known/oauth-protected-resource" });
  expect(response.statusCode).toBe(200);
  expect(response.json().authorization_servers).toContain(issuer);
});

it("lists a tool per connector capability", async () => {
  const response = await mcpClient.listTools();
  expect(response.tools.map((t) => t.name)).toContain("gmail.message_send");
});

it("refuses a tool call outside the connection grant", async () => {
  const response = await mcpClient.callTool({ name: "gmail.message_delete", arguments: {} });
  expect(response.isError).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace @adam/relay`
Expected: FAIL with a 404 for the unregistered route.

- [ ] **Step 3: Implement the MCP endpoint**

Add the Model Context Protocol TypeScript SDK v2 packages to `apps/relay/package.json`: `@modelcontextprotocol/server`, `@modelcontextprotocol/client`, and `@modelcontextprotocol/core`. Version 2 is the stable line implementing the 2026-07-28 specification. It replaces the monolithic `@modelcontextprotocol/sdk` package, requires Zod `^4.2.0`, and expects tool schemas to be Standard Schema objects, so a tool input is registered as `z.object(...)` rather than a raw shape.

Where a provider publishes an official remote MCP server, the relay should proxy to it rather than reimplementing the API surface. Google ships official servers for Gmail, Drive, Docs, Sheets, Slides, Calendar, and Chat under `mcp.googleapis.com`, and Supabase ships a hosted server. Proxying inherits the provider's quota handling and error semantics instead of maintaining them. The proxy still holds the credential and still applies the grant, the permission tier, and the audit, so the safety model is unchanged. Google's servers require Workspace Developer Preview Program membership and an OAuth client flagged for agent use, so this path is a follow-on rather than the first implementation.

Create `apps/relay/src/mcp/tools.ts` exporting a function that converts a connector manifest into MCP tool definitions. The tool name is the provider identifier, a dot, and the capability with underscores, for example `gmail.message_send`. Each tool's input schema is derived from the capability's declared arguments, and each tool's description states its risk tier. Registering a tool requires a connection identifier, which the tool resolves from the agent's bound connection rather than accepting one from the caller.

Create `apps/relay/src/mcp/server.ts` exporting `createMcpServer`, which registers the tools and exposes them over a Streamable HTTP transport in stateless mode.

Create `apps/relay/src/routes/mcp.ts` exporting `registerMcpRoutes`. The route authenticates the Adam-scoped bearer token presented by the daemon. An absent or invalid token returns 401 with a `WWW-Authenticate` header carrying the `resource_metadata` parameter. A valid token that is bound to a connection lacking the requested capability returns 403.

The `/.well-known/oauth-protected-resource` endpoint returns the RFC 9728 document. The `issuer` value comes from the relay configuration. The relay does not rely on Dynamic Client Registration, which the MCP specification has deprecated in favour of OAuth Client ID Metadata Documents, so the daemon's client registration uses a Client ID Metadata Document.

Modify `apps/relay/src/server.ts` to register the MCP routes.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace @adam/relay`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/relay package-lock.json
git commit -m "feat(relay): expose connector capabilities as an mcp server over streamable http"
```

---

### Task 7: Supabase connector

**Files:**
- Create: `apps/relay/src/connectors/providers/supabase.ts`
- Create: `apps/relay/test/supabase-connector.test.ts`
- Modify: `apps/relay/src/connectors/registry.ts`

**Interfaces:**
- Consumes: the `Connector` interface from `apps/relay/src/connectors/types.ts`.
- Produces:
  - `class SupabaseConnector implements Connector` — manifest identifier `supabase`, `authKind` of `api_key`, default risk tier `green`, capabilities `read` of `table.select` and `write` of `table.insert` and `table.update`.
  - `createSupabaseConnector(): SupabaseConnector`
  - `isRowLevelSecurityBypassingKey(key: string): boolean` — returns true for a secret key, which carries the service role and bypasses row-level security.

- [ ] **Step 1: Write the failing test**

Create `apps/relay/test/supabase-connector.test.ts`:

```ts
it("declares an api key auth kind and no oauth scopes", () => {
  expect(connector.manifest.authKind).toBe("api_key");
  expect(connector.manifest.scopes).toEqual([]);
});

it("identifies a secret key as bypassing row level security", () => {
  expect(isRowLevelSecurityBypassingKey("sb_secret_abc")).toBe(true);
  expect(isRowLevelSecurityBypassingKey("sb_publishable_abc")).toBe(false);
});

it("refuses to act with a key that bypasses row level security", async () => {
  await expect(connector.invoke({ connectionId, capability: "table.select", arguments: { table: "todos" }, signal })).rejects.toThrow(/row level security/i);
});

it("selects rows through postgrest", async () => {
  const result = await connector.invoke({ connectionId, capability: "table.select", arguments: { table: "todos", filter: "done=eq.false" }, signal });
  expect(result.data).toEqual([{ id: 1 }]);
});

it("refuses a capability that is not declared", async () => {
  await expect(connector.invoke({ connectionId, capability: "table.drop", arguments: {}, signal })).rejects.toThrow();
});

it("never includes the access token in the result", async () => {
  const result = await connector.invoke({ connectionId, capability: "table.select", arguments: { table: "todos" }, signal });
  expect(JSON.stringify(result)).not.toContain("sbp_secret");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace @adam/relay`
Expected: FAIL with a module-not-found error for `../src/connectors/providers/supabase.js`.

- [ ] **Step 3: Implement the connector**

Create `apps/relay/src/connectors/providers/supabase.ts`.

The manifest declares the `supabase` provider with `authKind` of `api_key` and no OAuth scopes, because a Supabase API key is a bearer token with no consent flow.

Export `isRowLevelSecurityBypassingKey`, which returns true for a key prefixed `sb_secret_` and false for a key prefixed `sb_publishable_`. A secret key carries the service role and bypasses row-level security, so the connector refuses to act with one and raises an error mentioning `row level security`.

The connector's `invoke` builds the request URL from the project reference and the table name, using the PostgREST convention. It sends the API key in the `apikey` header and the role-scoped key in the `Authorization` header, so row-level security still applies to every query. A `table.delete` capability is deliberately not declared, because a destructive capability would be red tier and would require a per-action approval that the product does not yet justify.

The connector must never place the access token into the returned data or the summary.

Register the connector in `apps/relay/src/connectors/registry.ts` at startup.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace @adam/relay`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/relay
git commit -m "feat(relay): add supabase connector over postgrest"
```

---

### Task 8: Gmail connector with send-first scope strategy

**Files:**
- Create: `apps/relay/src/connectors/providers/gmail.ts`
- Create: `apps/relay/src/connectors/providers/google-oauth.ts`
- Create: `apps/relay/test/gmail-connector.test.ts`
- Create: `apps/relay/test/google-oauth.test.ts`
- Modify: `apps/relay/src/connectors/registry.ts`

**Interfaces:**
- Consumes: the `Connector` interface from `apps/relay/src/connectors/types.ts` and the shared connector contracts.
- Produces:
  - `class GmailConnector implements Connector` — manifest identifier `gmail`, `authKind` of `oauth2_pkce`, default risk tier `green`, capabilities `read` of `message.list` and `write` of `message.send`.
  - `GMAIL_SEND_SCOPE` — the constant `"https://www.googleapis.com/auth/gmail.send"`.
  - `GMAIL_READ_SCOPE` — the constant `"https://www.googleapis.com/auth/gmail.readonly"`.
  - `createGoogleOAuthClient(config): GoogleOAuthClient` — performs the authorization code exchange with PKCE, and refreshes access tokens.
  - `GoogleOAuthClient` — an interface with `exchangeCode(code, codeVerifier): Promise<ConnectorAuthorization>` and `refresh(refreshToken): Promise<ConnectorAuthorization | null>`.

- [ ] **Step 1: Write the failing test**

Create `apps/relay/test/google-oauth.test.ts`:

```ts
it("returns null when the refresh token has been revoked", async () => {
  const client = createGoogleOAuthClient(configWith({ googleClientId, googleClientSecret }));
  const result = await client.refresh("revoked-token");
  expect(result).toBeNull();
});

it("never includes the refresh token in an error", async () => {
  const client = createGoogleOAuthClient(configWith({ googleClientId, googleClientSecret }));
  await expect(client.refresh("revoked-token")).resolves.toBeNull();
});
```

Create `apps/relay/test/gmail-connector.test.ts`:

```ts
it("requests only the send scope by default", () => {
  expect(connector.manifest.scopes).toEqual([GMAIL_SEND_SCOPE]);
});

it("treats message send as a yellow capability", () => {
  expect(effectiveRiskTier(connector.manifest, "message.send")).toBe("yellow");
});

it("treats message list as a green capability", () => {
  expect(effectiveRiskTier(connector.manifest, "message.list")).toBe("green");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace @adam/relay`
Expected: FAIL with a module-not-found error for the provider modules.

- [ ] **Step 3: Implement the connector and the OAuth client**

Create `apps/relay/src/connectors/providers/google-oauth.ts`. `exchangeCode` posts the authorization code and the PKCE verifier to the Google token endpoint and returns an authorization containing the access token, the refresh token when present, the expiry, and the granted scopes. The authorization request must set `access_type=offline`, because without it Google issues no refresh token and the user would have to re-authorize roughly every hour. It uses `code_challenge_method=S256` only. `prompt=consent` is used when a fresh refresh token is needed, since Google only issues one when consent is re-granted. `refresh` posts the refresh token to the token endpoint. When the provider responds with `invalid_grant`, it returns `null` rather than throwing, so the caller can move the connection to `expired`. No error path may include the refresh token or the access token in its message.

Create `apps/relay/src/connectors/providers/gmail.ts`. The manifest declares `gmail` with `authKind` of `oauth2_pkce` and a default risk tier of `green`. The capabilities are `read` of `message.list` and `write` of `message.send`.

The scopes field defaults to `GMAIL_SEND_SCOPE` alone. The read scope is deliberately not requested by default, because `gmail.readonly` is a restricted scope that triggers Google's restricted-scope verification and an annual third-party security assessment, while `gmail.send` is only a sensitive scope. `GMAIL_READ_SCOPE` is exported so that enabling inbox reading later is an explicit, reviewed change to the manifest rather than an accident.

The `message.send` capability sends through the Gmail API and is yellow tier. The `message.list` capability is green.

Register the connector in `apps/relay/src/connectors/registry.ts` at startup.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace @adam/relay`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm run ci`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/relay
git commit -m "feat(relay): add gmail connector with send-first scope strategy"
```

---

### Task 9: Notification connectors for email and push

**Files:**
- Create: `apps/relay/src/connectors/providers/resend.ts`
- Create: `apps/relay/src/connectors/providers/expo-push.ts`
- Create: `apps/relay/src/connectors/notify.ts`
- Create: `apps/relay/test/notify.test.ts`
- Modify: `apps/relay/src/connectors/registry.ts`
- Modify: `apps/relay/src/config.ts`

**Interfaces:**
- Consumes: the `Connector` interface from `apps/relay/src/connectors/types.ts`.
- Produces:
  - `class ResendConnector implements Connector` — manifest identifier `notification_email`, `authKind` of `api_key`, capability `notify` of `email.send`.
  - `class ExpoPushConnector implements Connector` — manifest identifier `notification_push`, `authKind` of `api_key`, capability `notify` of `push.send`.
  - `Notifier` — a class with `notify(channel: "email" | "push", input: NotifyInput): Promise<NotifyResult>`.
  - `NotifyInput` — `{ userId: string; title: string; body: string; actionUrl?: string; priority: "low" | "high" }`.
  - `NotifyResult` — `{ delivered: boolean; reason?: string }`.
  - `createNotifier(config: RelayConfig): Notifier`.

- [ ] **Step 1: Write the failing test**

Create `apps/relay/test/notify.test.ts`:

```ts
it("reports when the daily email quota is exhausted instead of throwing", async () => {
  const notifier = createNotifier(configWith({ resendApiKey, resendDailyLimit: 2, emailAlreadySentToday: 2 }));
  const result = await notifier.notify("email", input);
  expect(result.delivered).toBe(false);
  expect(result.reason).toMatch(/quota/i);
});

it("never sends more than the daily limit in one day", async () => {
  const notifier = createNotifier(configWith({ resendApiKey, resendDailyLimit: 2 }));
  await notifier.notify("email", input);
  await notifier.notify("email", input);
  const third = await notifier.notify("email", input);
  expect(third.delivered).toBe(false);
});

it("does not include the api key in a failure reason", async () => {
  const notifier = createNotifier(configWith({ resendApiKey: "re_secret" }));
  const result = await notifier.notify("email", input);
  expect(JSON.stringify(result)).not.toContain("re_secret");
});

it("marks a push notification as delivered when the gateway accepts it", async () => {
  const notifier = createNotifier(configWith({ expoPushUrl: fakeGatewayUrl }));
  const result = await notifier.notify("push", input);
  expect(result.delivered).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace @adam/relay`
Expected: FAIL with a module-not-found error for `../src/connectors/notify.js`.

- [ ] **Step 3: Implement the notification connectors**

Create `apps/relay/src/connectors/providers/resend.ts` with the `ResendConnector` class. Its manifest declares the `notification_email` provider with `authKind` of `api_key` and a single `notify` capability of `email.send`. The `invoke` method posts to the Resend send endpoint over HTTPS with the API key in the bearer position. It never sends directly over SMTP, because the relay's host blocks outbound port 25 and because sending an API key to a mail API over TLS is safer than sending it to a mail relay.

Create `apps/relay/src/connectors/providers/expo-push.ts` with the `ExpoPushConnector` class. Its manifest declares the `notification_push` provider with `authKind` of `api_key` and a single `notify` capability of `push.send`. The `invoke` method posts to the Expo push gateway and treats an accepted request as delivered.

Create `apps/relay/src/connectors/notify.ts` with the `Notifier` class and `createNotifier`. The notifier tracks how many emails it has sent in the current UTC day against the configured daily limit, and returns `{ delivered: false, reason: "daily quota exhausted" }` once the limit is reached. It never throws for a quota condition, because a blocked agent waiting for a decision is a normal state rather than an error. The counter is persisted in the database so it survives a relay restart, and the reset is computed from the database clock rather than the application host clock.

The notifier redacts the API key from every failure reason.

Register both connectors in `apps/relay/src/connectors/registry.ts` at startup. Add the configuration fields `resendApiKey`, `resendFromAddress`, `resendDailyLimit`, `expoPushUrl`, and `expoPushToken` to the relay configuration.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace @adam/relay`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm run ci`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/relay
git commit -m "feat(relay): add email and push notification connectors with quota enforcement"
```
