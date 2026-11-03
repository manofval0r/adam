# Cloud Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Adam's relay from an in-memory store to a durable Postgres-backed store, add artifact storage and retention enforcement, and produce the deployment tooling needed to run the relay unattended on a free-tier cloud host that may vanish at any moment.

**Architecture:** The relay's store becomes an interface with two implementations: the existing in-memory one for development and a Postgres one for production. The relay process itself holds no durable state, so losing the host is a redeploy rather than a data loss. Deployment is a reproducible container image plus a redeploy script that targets the same Postgres database.

**Tech Stack:** Node.js 20, TypeScript 5.6, Fastify 4, `pg` 8 (node-postgres), Vitest 2, Docker, AWS SDK v3 for S3-compatible object storage

**Spec:** [Cloud platform](../../cloud-platform.md)

**Depends on:** [Shared contracts plan](2026-10-24-shared-contracts.md)

## Global Constraints

- Node.js >= 20. TypeScript 5.6, Vitest 2. The only new runtime dependencies are `pg` and the AWS SDK v3 S3 client, both MIT licensed.
- The in-memory store remains the default in development and in tests. Production requires a Postgres connection string.
- The relay must refuse to start in production with the in-memory store. This guard already exists and must not be weakened.
- No durable state is held in the relay process, in a local file, or in the container filesystem. A container restart must lose nothing.
- All Postgres access goes through the pooled connection endpoint. Direct connections are not used anywhere.
- Schema changes are applied through versioned migration files, never by hand against a live database.
- Retention is enforced by a scheduled job. Pruning is idempotent and safe to run twice.
- Every table that stores user content has a `retention_class` and a deletion path.
- The deployment target is assumed to be disposable. There must be a documented way to rebuild and restart against an existing database with no data migration.

## Review Focus

1. A Postgres connection that dies mid-request, which happens routinely when serverless Postgres scales to zero after five minutes idle. The relay must reconnect and the request must not surface as a user-visible error.
2. A database at the free-tier storage ceiling of 1 GB. Writes that increase storage start failing at that point, so the headroom check must warn before the limit is reached rather than after.
3. Two relay instances running at once, which is normal after a host redeploy or a rolling restart. A prompt must be delivered to exactly one daemon, and an idempotent prompt submission must not create a second prompt.
4. A clock skew between the relay host and the database. Lease expiry and retention cutoffs must use the database clock, not the application host clock.
5. A database restore from a backup taken at the wrong moment, or a migration applied to a branch and merged with a conflicting schema. The restore path must be exercised against a branch, not against production.

---

### Task 1: Extract the relay store interface

**Files:**
- Create: `apps/relay/src/store/relay-store.ts`
- Create: `apps/relay/src/store/index.ts`
- Modify: `apps/relay/src/store.ts`
- Create: `apps/relay/test/store-interface.test.ts`

**Interfaces:**
- Consumes: the existing type definitions in `apps/relay/src/types.ts`.
- Produces:
  - `RelayStore` — an interface listing every public method currently on the `RelayStore` class: `upsertUser`, `issuePairingCode`, `exchangePairingCode`, `authenticateDeviceToken`, `recordHeartbeat`, `submitPrompt`, `dequeuePromptsForDevice`, `updatePromptState`, `listEventsForUser`, `listPromptsForUser`, `listSessionsForUser`, `listDevicesForUser`, plus the permission and connector-connection methods the existing class already exposes.
  - `createRelayStore(config: RelayConfig, options?: RelayStoreOptions): RelayStore` — returns the in-memory implementation when no database connection string is configured, and throws when production is configured without one.

- [ ] **Step 1: Write the failing test**

Create `apps/relay/test/store-interface.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createRelayStore } from "../src/store/index.js";
import { RelayStore } from "../src/store/relay-store.js";

describe("createRelayStore", () => {
  it("returns an in-memory store when no database url is configured", () => {
    const store = createRelayStore(configWith({}));
    expect(store).toBeDefined();
    expect(typeof store.submitPrompt).toBe("function");
  });

  it("throws when production is configured without a database url", () => {
    expect(() => createRelayStore(configWith({ environment: "production" }))).toThrow(
      /database/i,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace @adam/relay`
Expected: FAIL with a module-not-found error for `../src/store/index.js`.

- [ ] **Step 3: Extract the interface**

Create `apps/relay/src/store/relay-store.ts` declaring `export interface RelayStore` with every public method currently declared on the `RelayStore` class, each with its existing parameter and return types. Every type referenced by those signatures is imported from `../types.js` and, where the type is shared, from `@adam/contracts`.

Modify `apps/relay/src/store.ts` so the class is declared as `export class InMemoryRelayStore implements RelayStore` and keeps its existing behaviour exactly. Keep the exported name `RelayStore` available as a re-export of the interface for the call sites that use it as a type.

Create `apps/relay/src/store/index.ts` exporting `createRelayStore`. It reads the database connection string from the relay configuration. When the string is absent and the environment is not production, it returns `new InMemoryRelayStore(config, options)`. When the string is absent and the environment is production, it throws an error mentioning `database`. When the string is present, it returns the Postgres implementation, which does not exist yet, so for this task it throws an error mentioning `not yet implemented` and is replaced in the next task.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace @adam/relay`
Expected: PASS.

- [ ] **Step 5: Run the full suite to confirm nothing regressed**

Run: `npm run ci`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/relay
git commit -m "refactor(relay): extract RelayStore interface from in-memory implementation"
```

---

### Task 2: Postgres pool and migration runner

**Files:**
- Create: `apps/relay/src/db/pool.ts`
- Create: `apps/relay/src/db/migrate.ts`
- Create: `apps/relay/src/db/migrations/0001_core.sql`
- Create: `apps/relay/test/migrate.test.ts`
- Modify: `apps/relay/package.json`
- Modify: `apps/relay/src/config.ts`

**Interfaces:**
- Consumes: the relay configuration.
- Produces:
  - `createPool(connectionString: string): Pool` — a `pg` pool configured with a maximum of 10 connections, a 10-second idle timeout, a 30-second connection timeout, and `application_name` set to `adam-relay`.
  - `runMigrations(pool: Pool, migrationsDir: string): Promise<string[]>` — applies every unapplied migration file in filename order and returns the names of the migrations applied. It is safe to call repeatedly.
  - `MIGRATIONS_DIR` — the absolute path to the bundled migrations directory.

- [ ] **Step 1: Write the failing test**

Create `apps/relay/test/migrate.test.ts`. The test uses a throwaway schema in the configured test database, applies the migrations, asserts that the expected tables exist, and applies the migrations a second time to prove idempotency:

```ts
it("creates the core tables", async () => {
  await runMigrations(pool, MIGRATIONS_DIR);
  const result = await pool.query(
    "select table_name from information_schema.tables where table_schema = $1",
    [schemaName],
  );
  const names = result.rows.map((row) => row.table_name);
  expect(names).toEqual(expect.arrayContaining(["users", "devices", "sessions", "prompts", "events"]));
});

it("is idempotent", async () => {
  await runMigrations(pool, MIGRATIONS_DIR);
  const second = await runMigrations(pool, MIGRATIONS_DIR);
  expect(second).toEqual([]);
});
```

The test must skip itself with a clear message when no test database URL is configured, so `npm run ci` stays green for contributors without a database.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace @adam/relay`
Expected: FAIL with a module-not-found error for `../src/db/migrate.js`.

- [ ] **Step 3: Implement the pool and the migration runner**

Create `apps/relay/src/db/pool.ts` exporting `createPool` with the configuration listed in the Interfaces block.

Create `apps/relay/src/db/migrate.ts` exporting `runMigrations` and `MIGRATIONS_DIR`. The runner creates a `schema_migrations` table recording the migration name and the timestamp it was applied. It reads migration files from the directory in ascending filename order, skips any name already present in `schema_migrations`, and executes the remaining ones inside a transaction each. It returns the names of the migrations it applied in this call.

Create `apps/relay/src/db/migrations/0001_core.sql` defining the core tables with their primary keys, foreign keys, and indexes:

- `users`, `devices`, `pairing_codes`, `sessions`, `prompts`, `events`
- Every content-bearing table carries `created_at timestamptz` and, where it applies, `retention_class text` with a default.
- `prompts` carries `client_prompt_id text` with a unique index over `(user_id, client_prompt_id)` to enforce prompt idempotency.
- `prompts` carries `lease_expires_at timestamptz` and a `status text` column.
- `events` carries `(user_id, sequence)` with a unique index, and `occurred_at timestamptz` plus a separate `ingested_at timestamptz default now()` so device clock skew cannot affect ordering.

Add `pg` and its types to `apps/relay/package.json`. Add a `databaseUrl` field to the relay configuration, optional in development and required in production.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace @adam/relay`
Expected: PASS when a test database URL is configured, and SKIPPED with a clear message otherwise.

- [ ] **Step 5: Commit**

```bash
git add apps/relay package-lock.json
git commit -m "feat(relay): add postgres pool and migration runner with core schema"
```

---

### Task 3: Postgres-backed relay store

**Files:**
- Create: `apps/relay/src/store/postgres.ts`
- Create: `apps/relay/test/postgres-store.test.ts`
- Modify: `apps/relay/src/store/index.ts`

**Interfaces:**
- Consumes: `createPool` from `apps/relay/src/db/pool.ts`, the `RelayStore` interface from `apps/relay/src/store/relay-store.ts`.
- Produces:
  - `class PostgresRelayStore implements RelayStore` — constructor takes `(pool: Pool, options?: RelayStoreOptions)`.
  - `createRelayStore` returns `new PostgresRelayStore(pool)` when a database URL is configured.

- [ ] **Step 1: Write the failing test**

Create `apps/relay/test/postgres-store.test.ts`. The test applies the migrations to a throwaway schema, constructs the store against it, and asserts the behaviours that differ from the in-memory implementation:

```ts
it("returns the same prompt for a repeated clientPromptId", async () => {
  const first = await store.submitPrompt(userId, sessionId, "hello", "client_1");
  const second = await store.submitPrompt(userId, sessionId, "hello", "client_1");
  expect(second.id).toBe(first.id);
});

it("delivers a prompt to exactly one device", async () => {
  await store.submitPrompt(userId, sessionId, "hello", "client_1");
  const first = await store.dequeuePromptsForDevice(deviceId, 10);
  const second = await store.dequeuePromptsForDevice(deviceId, 10);
  expect(first).toHaveLength(1);
  expect(second).toHaveLength(0);
});

it("expires a lease using the database clock", async () => {
  const dequeued = await store.dequeuePromptsForDevice(deviceId, 10);
  await expireLeaseInDatabase(promptId);
  const result = await store.updatePromptState(deviceId, promptId, { status: "failed" });
  expect(result.status).toBe("failed");
});

it("orders events by the ingestion sequence, not the device clock", async () => {
  await store.appendEvent(eventWithOccurredAt("2020-01-01T00:00:00.000Z"));
  await store.appendEvent(eventWithOccurredAt("2099-01-01T00:00:00.000Z"));
  const events = await store.listEventsForUser(userId, 0, 10);
  expect(events.map((event) => event.sequence)).toEqual([1, 2]);
});

it("reconnects after the pooled connection dies", async () => {
  await terminatePoolConnections(pool);
  const result = await store.listSessionsForUser(userId);
  expect(Array.isArray(result)).toBe(true);
});
```

The test skips itself with a clear message when no test database URL is configured.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace @adam/relay`
Expected: FAIL with a module-not-found error for `../src/store/postgres.js`.

- [ ] **Step 3: Implement the Postgres store**

Create `apps/relay/src/store/postgres.ts` implementing every method of `RelayStore` against the schema from the previous task.

The implementation must observe these rules:

- Every write that assigns a sequence number uses an atomic statement, either a sequence-backed column or `insert ... returning`, never a read-then-write.
- `submitPrompt` performs an insert with `on conflict (user_id, client_prompt_id) do nothing`, then selects the existing row when the insert affected no rows, so a repeated submission returns the original prompt rather than creating a second one.
- `dequeuePromptsForDevice` selects eligible prompts with `for update skip locked` and a lease predicate that compares against the database's `now()`, so two relay instances never deliver the same prompt.
- `updatePromptState` verifies that the prompt's lease belongs to the calling device and that the requested transition is legal before writing, reusing the same transition rules as the in-memory implementation.
- `listEventsForUser` orders by the stored sequence, never by `occurredAt`.
- Tokens are hashed with the same `hashToken` helper already used by the in-memory store before being written.

Modify `apps/relay/src/store/index.ts` so `createRelayStore` returns the Postgres implementation when a database URL is configured.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace @adam/relay`
Expected: PASS when a test database URL is configured, and SKIPPED otherwise.

- [ ] **Step 5: Run the full suite**

Run: `npm run ci`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/relay
git commit -m "feat(relay): implement postgres-backed relay store"
```

---

### Task 4: Retention pruning and free-tier headroom monitoring

**Files:**
- Create: `apps/relay/src/retention/prune.ts`
- Create: `apps/relay/src/retention/headroom.ts`
- Create: `apps/relay/test/retention.test.ts`
- Modify: `apps/relay/src/main.ts`

**Interfaces:**
- Consumes: the `Pool` from `apps/relay/src/db/pool.ts` and the shared event and retention contracts.
- Produces:
  - `pruneExpired(pool: Pool, now?: Date): Promise<PruneResult>` — deletes expired rows per the retention table and returns `{ events, prompts, sessions, artifacts, bytesReclaimed }`.
  - `checkHeadroom(pool: Pool, limits: FreeTierLimits): Promise<HeadroomReport>` — returns `{ storageBytes, storageLimitBytes, storagePercent, egressBytes, egressLimitBytes, warnings }`.
  - `FreeTierLimits` — `{ storageBytes: number; egressBytes: number }`.
  - `startRetentionJobs(pool: Pool, limits: FreeTierLimits, intervalMs: number): () => void` — starts the prune and headroom schedules and returns a function that stops them.

- [ ] **Step 1: Write the failing test**

Create `apps/relay/test/retention.test.ts`:

```ts
it("deletes events past the retention window and keeps newer ones", async () => {
  await insertEvent(ageInDays(40));
  await insertEvent(ageInDays(5));
  const result = await pruneExpired(pool);
  expect(result.events).toBe(1);
  expect(await countEvents()).toBe(1);
});

it("is idempotent", async () => {
  await insertEvent(ageInDays(40));
  await pruneExpired(pool);
  const second = await pruneExpired(pool);
  expect(second.events).toBe(0);
});

it("warns before the storage ceiling is reached", async () => {
  const report = await checkHeadroom(pool, { storageBytes: 1000, egressBytes: 1000 });
  expect(report.warnings.length).toBeGreaterThan(0);
});

it("does not warn when headroom is comfortable", async () => {
  const report = await checkHeadroom(pool, { storageBytes: 1_000_000_000, egressBytes: 1_000_000_000 });
  expect(report.warnings).toEqual([]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace @adam/relay`
Expected: FAIL with a module-not-found error for `../src/retention/prune.js`.

- [ ] **Step 3: Implement pruning and headroom monitoring**

Create `apps/relay/src/retention/prune.ts` exporting `pruneExpired`. It deletes events older than 30 days, prompts and their decisions older than 90 days, sessions whose end is older than 90 days, and connector action records older than 90 days. Each delete runs in its own statement with a bound cutoff parameter, never an interpolated literal. The function returns the row counts and the estimated bytes reclaimed, computed from `pg_total_relation_size` before and after.

Create `apps/relay/src/retention/headroom.ts` exporting `checkHeadroom` and the `FreeTierLimits` type. It measures database size with `pg_database_size`, compares it against the configured limit, and produces a warning when usage is at or above 80 percent. It returns warnings as strings that name the resource and the percentage.

Create `apps/relay/src/retention/index.ts` exporting `startRetentionJobs`, which schedules pruning daily and the headroom check daily, using `setInterval` with `unref` so the timer never keeps the process alive.

Modify `apps/relay/src/main.ts` to call `startRetentionJobs` when the relay starts with a database configured, and to log the headroom report once at startup.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace @adam/relay`
Expected: PASS when a test database URL is configured, and SKIPPED otherwise.

- [ ] **Step 5: Commit**

```bash
git add apps/relay
git commit -m "feat(relay): add retention pruning and free-tier headroom monitoring"
```

---

### Task 5: S3-compatible artifact storage

**Files:**
- Create: `apps/relay/src/storage/object-storage.ts`
- Create: `apps/relay/src/storage/r2.ts`
- Create: `apps/relay/test/object-storage.test.ts`
- Modify: `apps/relay/package.json`
- Modify: `apps/relay/src/config.ts`

**Interfaces:**
- Consumes: the relay configuration.
- Produces:
  - `ObjectStorage` — an interface with `put(key: string, body: Buffer, contentType: string): Promise<{ key: string; url: string }>`, `get(key: string): Promise<Buffer>`, `delete(key: string): Promise<void>`, and `list(prefix: string): Promise<string[]>`.
  - `createObjectStorage(config: RelayConfig): ObjectStorage` — returns the R2 implementation when a bucket and endpoint are configured, and a local-filesystem implementation writing under `.adam/artifacts` otherwise. The local implementation is for development only and must log a warning when selected in production.
  - `artifactKey(sessionId: string, kind: string, extension: string): string` — builds a key of the form `artifacts/<sessionId>/<kind>/<timestamp>-<random>.<extension>`.

- [ ] **Step 1: Write the failing test**

Create `apps/relay/test/object-storage.test.ts`:

```ts
it("round trips an artifact", async () => {
  const storage = createObjectStorage(configWith({ artifactDir: tempDir }));
  const { key } = await storage.put("session", Buffer.from("hello"), "text/plain");
  expect((await storage.get(key)).toString()).toBe("hello");
  await storage.delete(key);
  await expect(storage.get(key)).rejects.toThrow();
});

it("builds a key that groups artifacts by session", () => {
  const key = artifactKey("ses_01", "diff", "patch");
  expect(key.startsWith("artifacts/ses_01/diff/")).toBe(true);
  expect(key.endsWith(".patch")).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace @adam/relay`
Expected: FAIL with a module-not-found error for `../src/storage/object-storage.js`.

- [ ] **Step 3: Implement the storage adapters**

Create `apps/relay/src/storage/object-storage.ts` exporting the `ObjectStorage` interface, `artifactKey`, and `createObjectStorage`.

Create `apps/relay/src/storage/r2.ts` exporting `class R2ObjectStorage implements ObjectStorage`, backed by the AWS SDK v3 S3 client with `forcePathStyle` enabled, since R2 and other S3-compatible providers require path-style addressing. The `put` method sets the content type and returns a URL built from the configured public base URL. The `list` method uses the delimiter-free ListObjectsV2 call with the given prefix.

Create the local-filesystem implementation in `apps/relay/src/storage/local.ts`, writing under the configured artifact directory and creating parent directories as needed.

Add the AWS SDK S3 client packages to `apps/relay/package.json`. Add the artifact configuration fields to the relay configuration: `artifactBucket`, `artifactEndpoint`, `artifactAccessKeyId`, `artifactSecretAccessKey`, `artifactPublicBaseUrl`, and `artifactDir`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace @adam/relay`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/relay package-lock.json
git commit -m "feat(relay): add s3-compatible artifact storage with local fallback"
```

---

### Task 6: Deployment tooling and runbook

**Files:**
- Create: `apps/relay/Dockerfile`
- Create: `apps/relay/.dockerignore`
- Create: `scripts/deploy-relay.sh`
- Create: `scripts/backup-database.sh`
- Create: `scripts/restore-database.sh`
- Create: `scripts/keepalive.sh`
- Create: `docs/deployment-runbook.md`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: the relay configuration and the migrations directory.
- Produces:
  - `npm run deploy:relay` — builds the image and restarts the relay on the configured host.
  - `npm run backup:db` — dumps the database to the artifact bucket and verifies the dump is non-empty.
  - `npm run restore:db` — restores into a branch first and reports the branch name, requiring explicit confirmation before promoting.
  - `npm run keepalive` — a single request that keeps the host above the idle-reclamation threshold.

- [ ] **Step 1: Write the failing test**

Create `scripts/check-deploy-scripts.mjs`, a dependency-free script that asserts the deployment surface exists and is coherent:

```js
const required = [
  ["apps/relay/Dockerfile", /FROM node:/],
  ["scripts/deploy-relay.sh", /docker build/],
  ["scripts/backup-database.sh", /pg_dump/],
  ["scripts/restore-database.sh", /pg_restore/],
  ["scripts/restore-database.sh", /branch/i],
  ["docs/deployment-runbook.md", /Redeploy/],
];
```

The script fails when any file is missing or lacks its marker pattern. It is added to the root `check` script so it runs in CI.

- [ ] **Step 2: Run the check to verify it fails**

Run: `npm run check`
Expected: FAIL, reporting the missing deployment files.

- [ ] **Step 3: Implement the deployment surface**

Create `apps/relay/Dockerfile` as a multi-stage build: a builder stage that compiles TypeScript, and a runtime stage based on `node:20-slim` that installs production dependencies only and runs the compiled entry point as a non-root user. The runtime stage must not contain source files or test files.

Create `scripts/deploy-relay.sh` that builds the image with a content-derived tag, pushes it to the configured registry, and restarts the relay, then waits for the health endpoint to return 200 before reporting success.

Create `scripts/backup-database.sh` that runs `pg_dump` against the pooled connection string, writes the dump to the artifact bucket under `backups/`, and fails loudly when the resulting file is smaller than a threshold or is empty.

Create `scripts/restore-database.sh` that creates a branch, restores into it, reports the branch name and a row count per core table, and refuses to promote without an explicit confirmation flag.

Create `scripts/keepalive.sh` that performs a single authenticated request against the relay's health endpoint.

Create `docs/deployment-runbook.md` with these sections, each stating a concrete command: `Initial deployment`, `Redeploy`, `Host reclaimed`, `Database restore`, `Backup verification`, `Key rotation`, `Where free ends`.

Add `deploy:relay`, `backup:db`, `restore:db`, and `keepalive` scripts to the root `package.json`, and add `node scripts/check-deploy-scripts.mjs` to the `check` script.

Add the deployment runbook to the README's document list.

- [ ] **Step 4: Run the check to verify it passes**

Run: `npm run check`
Expected: PASS, reporting the documentation health check and the deployment check.

- [ ] **Step 5: Run the full suite**

Run: `npm run ci`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/relay scripts docs README.md package.json
git commit -m "feat(deploy): add container build, deploy, backup, restore, and keepalive tooling"
```
