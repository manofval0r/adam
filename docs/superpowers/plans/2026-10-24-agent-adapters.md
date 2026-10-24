# Agent Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a reusable adapter interface from the existing Codex implementation, then add OpenCode as a fully controllable second agent, followed by ingestion-only support for Claude Code and GitHub Copilot.

**Architecture:** The daemon's Codex support becomes one implementation of a shared adapter interface with an explicit capability manifest. OpenCode is driven in server-backed mode, where one long-lived `opencode serve` process is kept alive and each prompt attaches to it, which keeps the MCP connection to Adam's connector hub open across turns. Claude Code and Copilot ship as ingestion-only adapters that read documented session exports rather than being remotely driven.

**Tech Stack:** Node.js 20, TypeScript 5.6, Zod 4.2, Vitest 2, the shared contracts package

**Spec:** [Adapter contract](../../adapter-contract.md), [Integration surface research](../../integration-surface-research.md), [Event schema](../../event-schema.md)

**Depends on:** [Shared contracts plan](2026-10-24-shared-contracts.md)

## Global Constraints

- No adapter reads an undocumented private format when the tool publishes a documented interface. OpenCode session data is read through `opencode export`, never by opening `opencode.db`.
- An adapter that cannot safely support a capability does not declare it. The manifest is the contract, and the web and mobile clients render from it.
- No adapter passes a flag that suppresses the tool's own permission flow. Adam forwards the approval to the phone rather than bypassing it.
- Optional CLI flags are detected at runtime. Tool CLIs add flags between releases, so `opencode run --help` is parsed at detection time rather than assumed.
- Prompt text reaches the tool on stdin. It is never interpolated into a shell command line.
- Every adapter emits normalized events through the shared contracts package. No adapter defines its own event envelope.
- A tool failure is classified as retryable or terminal. A retryable failure is retried with backoff; a terminal failure surfaces to the user.
- An unknown or changed event type from a tool is tolerated, recorded as an unsupported event, and never crashes the stream parser.

## Review Focus

1. A tool version that emits an event type the adapter has never seen. The parser must skip it, keep the stream aligned, and record it as unsupported rather than throwing.
2. A prompt that contains shell metacharacters, a newline, or something that looks like a flag. It must reach the tool as prompt text and nothing else.
3. A session id that no longer exists, because the user deleted the session or moved the project. The adapter must report a terminal failure and must not silently start a different session.
4. The tool's approval request arriving while the user is not looking at the phone. The request must persist as a pending event and be delivered when the phone reconnects, not dropped.
5. A tool binary that is present but a version too old to support the flag the adapter wants. The adapter must degrade to the capabilities the installed version actually has.

---

### Task 1: Extract the adapter interface and capability manifest

**Files:**
- Create: `apps/daemon/src/adapters/types.ts`
- Create: `apps/daemon/src/adapters/registry.ts`
- Create: `apps/daemon/test/adapter-registry.test.ts`
- Modify: `apps/daemon/src/codex.ts`
- Modify: `apps/daemon/src/prompt-worker.ts`

**Interfaces:**
- Consumes: the shared event and permission contracts from `@adam/contracts`.
- Produces:
  - `AdamAdapter` — the interface defined in the adapter contract document, with `manifest`, `detect`, optional `start`, optional `resume`, optional `stop`, optional `sendPrompt`, `subscribe`, and `getHealth`.
  - `AdapterManifest` — `{ id: string; displayName: string; version: string; riskTier: "green" | "yellow" | "red"; runtime: "local_daemon" | "cloud_runner" | "import_only"; capabilities: AdapterCapabilities }`.
  - `AdapterCapabilities` — the eleven booleans listed in the adapter contract document.
  - `AdapterRegistry` — a class with `register(adapter: AdamAdapter): void`, `get(id: string): AdamAdapter` which throws `AdapterRegistryError` when the adapter is unknown, and `list(): AdapterManifest[]`.
  - `AdapterRegistryError` — error class for an unknown adapter.

- [ ] **Step 1: Write the failing test**

Create `apps/daemon/test/adapter-registry.test.ts`:

```ts
it("throws for an unknown adapter", () => {
  expect(() => registry.get("nope")).toThrow(/unknown adapter/i);
});

it("rejects a second adapter for the same id", () => {
  registry.register(codexAdapter);
  expect(() => registry.register(codexAdapter)).toThrow(/already registered/i);
});

it("lists the registered manifests", () => {
  registry.register(codexAdapter);
  expect(registry.list().map((m) => m.id)).toContain("codex_cli");
});

it("declares the codex capabilities the daemon actually implements", () => {
  expect(codexAdapter.manifest.capabilities.resumeSession).toBe(true);
  expect(codexAdapter.manifest.capabilities.sendPrompt).toBe(true);
  expect(codexAdapter.manifest.capabilities.writeFiles).toBe(false);
  expect(codexAdapter.manifest.capabilities.runShell).toBe(false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace @adam/daemon`
Expected: FAIL with a module-not-found error for `../src/adapters/registry.js`.

- [ ] **Step 3: Implement the interface and registry**

Create `apps/daemon/src/adapters/types.ts` with the `AdamAdapter`, `AdapterManifest`, `AdapterCapabilities`, `AdapterDetectContext`, `AdapterDetectResult`, `AdapterSession`, `AdapterPromptContext`, `AdapterPromptResult`, `AdapterEventBatch`, `AdapterHealth`, and `AdapterError` types, matching the adapter contract document exactly.

Create `apps/daemon/src/adapters/registry.ts` with the `AdapterRegistry` class. `register` rejects a duplicate adapter id with a message containing `already registered`. `get` throws `AdapterRegistryError` with a message containing `unknown adapter`.

Modify `apps/daemon/src/codex.ts` so the existing Codex logic is exposed as an object satisfying `AdamAdapter`, with a manifest whose `id` is `codex_cli`, whose `runtime` is `local_daemon`, and whose capabilities reflect only what the implementation actually does today: detection, session detection, resume, prompt sending, and activity streaming are true; direct file writes, direct shell execution, and permission requests are false.

Modify `apps/daemon/src/prompt-worker.ts` to resolve the adapter from the registry rather than calling the Codex functions directly. Behaviour must not change.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace @adam/daemon`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm run ci`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/daemon
git commit -m "refactor(daemon): extract adapter interface and registry from codex implementation"
```

---

### Task 2: OpenCode detection and flag probing

**Files:**
- Create: `apps/daemon/src/adapters/opencode/detect.ts`
- Create: `apps/daemon/test/opencode-detect.test.ts`

**Interfaces:**
- Consumes: the `AdamAdapter` interface from `apps/daemon/src/adapters/types.ts`.
- Produces:
  - `detectOpenCode(context: AdapterDetectContext): Promise<AdapterDetectResult>` — checks availability, probes supported flags, and lists sessions.
  - `OpenCodeFlags` — `{ format: boolean; session: boolean; continue: boolean; fork: boolean; attach: boolean; skipPermissions: boolean }`.
  - `probeOpenCodeFlags(binary: string): Promise<OpenCodeFlags>` — runs `<binary> run --help`, parses the output, and records which flags the installed build advertises.
  - `listOpenCodeSessions(binary: string, workingDirectory: string): Promise<Array<{ adapterSessionId: string; title?: string; workingDirectory?: string; lastSeenAt?: string; state: "active" | "idle" | "stopped" | "unknown" }>>`.

- [ ] **Step 1: Write the failing test**

Create `apps/daemon/test/opencode-detect.test.ts`:

```ts
it("reports unavailable when the binary is missing", async () => {
  const result = await detectOpenCode({ workingDirectory, environment: "local" }, { binary: "opencode-not-installed" });
  expect(result.available).toBe(false);
});

it("records only the flags the installed build advertises", async () => {
  const flags = await probeOpenCodeFlags(fakeBinaryWithHelpText("  --format   output format\n  --session  session id\n"));
  expect(flags.format).toBe(true);
  expect(flags.session).toBe(true);
  expect(flags.skipPermissions).toBe(false);
});

it("does not assume a flag exists on an older build", async () => {
  const flags = await probeOpenCodeFlags(fakeBinaryWithHelpText("  --format   output format\n"));
  expect(flags.attach).toBe(false);
  expect(flags.skipPermissions).toBe(false);
});

it("returns sessions with their ids", async () => {
  const sessions = await listOpenCodeSessions(fakeBinaryPrintingJson([{ id: "ses_abc", title: "fix bug" }]), workingDirectory);
  expect(sessions[0].adapterSessionId).toBe("ses_abc");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace @adam/daemon`
Expected: FAIL with a module-not-found error for `../src/adapters/opencode/detect.js`.

- [ ] **Step 3: Implement detection**

Create `apps/daemon/src/adapters/opencode/detect.ts`.

`detectOpenCode` runs `opencode --version` to establish availability, then calls `probeOpenCodeFlags` and `listOpenCodeSessions`. When the binary is absent it returns `{ available: false, sessions: [] }` without throwing.

`probeOpenCodeFlags` runs `opencode run --help` and inspects the output for each known flag. A flag that is present sets its boolean to true. The `skipPermissions` flag is detected but never used by the adapter; it exists so the daemon can report to the user that their installed build offers a way to bypass approvals, and the adapter refuses to pass it.

`listOpenCodeSessions` runs `opencode session list --format json` in the working directory, parses the JSON, and maps each entry into the detection result shape. A parse failure returns an empty list and an error entry rather than throwing.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace @adam/daemon`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/daemon
git commit -m "feat(daemon): add opencode detection and runtime flag probing"
```

---

### Task 3: OpenCode server lifecycle

**Files:**
- Create: `apps/daemon/src/adapters/opencode/server.ts`
- Create: `apps/daemon/test/opencode-server.test.ts`

**Interfaces:**
- Consumes: `OpenCodeFlags` from `apps/daemon/src/adapters/opencode/detect.ts`.
- Produces:
  - `class OpenCodeServer` — with `start(): Promise<string>` returning the attach URL, `attachUrl(): string`, `stop(): Promise<void>`, and `isRunning(): boolean`.
  - `startOpenCodeServer(options: OpenCodeServerOptions): OpenCodeServer` — `OpenCodeServerOptions` is `{ binary: string; workingDirectory: string; port?: number; startupTimeoutMs?: number }`.
  - `OpenCodeServerError` — error class for a server that fails to start.

- [ ] **Step 1: Write the failing test**

Create `apps/daemon/test/opencode-server.test.ts`:

```ts
it("starts the server and returns an attach url", async () => {
  const server = startOpenCodeServer({ binary: fakeBinaryServingOn(port), workingDirectory });
  const url = await server.start();
  expect(url).toContain(String(port));
  await server.stop();
});

it("reports a server that never becomes ready", async () => {
  const server = startOpenCodeServer({ binary: fakeBinaryThatNeverServes(), workingDirectory, startupTimeoutMs: 500 });
  await expect(server.start()).rejects.toThrow(/never became ready/i);
});

it("is idempotent when started twice", async () => {
  const server = startOpenCodeServer({ binary: fakeBinaryServingOn(port), workingDirectory });
  const first = await server.start();
  const second = await server.start();
  expect(second).toBe(first);
});

it("stops cleanly and reports that it is no longer running", async () => {
  const server = startOpenCodeServer({ binary: fakeBinaryServingOn(port), workingDirectory });
  await server.start();
  await server.stop();
  expect(server.isRunning()).toBe(false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace @adam/daemon`
Expected: FAIL with a module-not-found error for `../src/adapters/opencode/server.js`.

- [ ] **Step 3: Implement the server manager**

Create `apps/daemon/src/adapters/opencode/server.ts`.

`start` spawns `opencode serve` as a detached child process in the working directory, waits for the port to accept a connection, and returns the attach URL `http://127.0.0.1:<port>`. The port is chosen explicitly rather than left to the tool, so the attach URL is known before the server reports readiness. When the port does not accept a connection within the startup timeout, the child is terminated and `OpenCodeServerError` is thrown with a message containing `never became ready`.

`start` is idempotent: a second call returns the same URL without spawning a second process.

`stop` terminates the child process and waits for it to exit. A server that was never started stops without throwing.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace @adam/daemon`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/daemon
git commit -m "feat(daemon): add opencode server lifecycle manager"
```

---

### Task 4: OpenCode prompt execution and event normalization

**Files:**
- Create: `apps/daemon/src/adapters/opencode/events.ts`
- Create: `apps/daemon/src/adapters/opencode/prompt.ts`
- Create: `apps/daemon/test/opencode-events.test.ts`
- Create: `apps/daemon/test/opencode-prompt.test.ts`

**Interfaces:**
- Consumes: the `AdamAdapter` interface, the shared event contracts from `@adam/contracts`, and the `OpenCodeServer` from `apps/daemon/src/adapters/opencode/server.ts`.
- Produces:
  - `parseOpenCodeEventLine(line: string): NormalizedOpenCodeEvent | null` — parses one line of the JSON event stream into a normalized event, returning null for a line that is not a recognised event.
  - `NormalizedOpenCodeEvent` — `{ kind: "message" | "tool" | "permission" | "session" | "error" | "unsupported"; payload: Record<string, unknown>; sessionId?: string }`.
  - `runOpenCodePrompt(options: OpenCodePromptOptions): Promise<OpenCodePromptResult>` — `OpenCodePromptOptions` is `{ binary: string; workingDirectory: string; prompt: string; sessionId?: string; attachUrl?: string; flags: OpenCodeFlags; env?: Record<string, string>; signal?: AbortSignal }`.
  - `OpenCodePromptResult` — `{ state: "adapter_sent" | "acknowledged" | "failed"; sessionId?: string; events: NormalizedOpenCodeEvent[]; error?: AdapterError }`.

- [ ] **Step 1: Write the failing test**

Create `apps/daemon/test/opencode-events.test.ts`:

```ts
it("parses a message event", () => {
  const event = parseOpenCodeEventLine(JSON.stringify({ type: "message", properties: { text: "hello" } }));
  expect(event?.kind).toBe("message");
});

it("captures the session id from the stream", () => {
  const event = parseOpenCodeEventLine(JSON.stringify({ type: "session", properties: { sessionID: "ses_abc" } }));
  expect(event?.sessionId).toBe("ses_abc");
});

it("returns null for a line that is not an event", () => {
  expect(parseOpenCodeEventLine("not json")).toBeNull();
});

it("marks an unknown event type as unsupported rather than throwing", () => {
  const event = parseOpenCodeEventLine(JSON.stringify({ type: "some_future_event", properties: {} }));
  expect(event?.kind).toBe("unsupported");
});

it("does not treat a permission event as a message", () => {
  const event = parseOpenCodeEventLine(JSON.stringify({ type: "permission", properties: { id: "p1" } }));
  expect(event?.kind).toBe("permission");
});
```

Create `apps/daemon/test/opencode-prompt.test.ts`:

```ts
it("sends the prompt on stdin rather than on the command line", async () => {
  const recorder = fakeBinaryRecordingArgvAndStdin();
  await runOpenCodePrompt({ binary: recorder.path, workingDirectory, prompt: "hello $(whoami)", flags, signal });
  expect(recorder.argv.join(" ")).not.toContain("whoami");
  expect(recorder.stdin).toContain("hello $(whoami)");
});

it("attaches to a running server when an attach url is given", async () => {
  const recorder = fakeBinaryRecordingArgvAndStdin();
  await runOpenCodePrompt({ binary: recorder.path, workingDirectory, prompt: "hi", attachUrl: "http://127.0.0.1:4096", flags });
  expect(recorder.argv).toContain("--attach");
  expect(recorder.argv).toContain("http://127.0.0.1:4096");
});

it("never passes the permission bypass flag", async () => {
  const recorder = fakeBinaryRecordingArgvAndStdin();
  await runOpenCodePrompt({ binary: recorder.path, workingDirectory, prompt: "hi", flags: { ...flags, skipPermissions: true } });
  expect(recorder.argv.join(" ")).not.toContain("--dangerously-skip-permissions");
});

it("returns a terminal failure when the session does not exist", async () => {
  const recorder = fakeBinaryFailingWith("session not found");
  const result = await runOpenCodePrompt({ binary: recorder.path, workingDirectory, prompt: "hi", sessionId: "ses_missing", flags });
  expect(result.state).toBe("failed");
  expect(result.error?.retryable).toBe(false);
});

it("returns a retryable failure when the tool exits non-zero transiently", async () => {
  const recorder = fakeBinaryFailingWith("rate limit exceeded");
  const result = await runOpenCodePrompt({ binary: recorder.path, workingDirectory, prompt: "hi", flags });
  expect(result.error?.retryable).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace @adam/daemon`
Expected: FAIL with a module-not-found error for `../src/adapters/opencode/prompt.js`.

- [ ] **Step 3: Implement the parser and the runner**

Create `apps/daemon/src/adapters/opencode/events.ts`. `parseOpenCodeEventLine` parses one line as JSON. A line that is not valid JSON returns null. A recognised event type maps to its normalized kind. An unrecognised type maps to `unsupported` with the original type preserved in the payload, so the daemon can record that the installed tool produced something the adapter does not understand. A session event contributes its session id.

Create `apps/daemon/src/adapters/opencode/prompt.ts`. `runOpenCodePrompt` spawns the binary with the arguments `run`, `--format`, `json`, and, when supplied, `--session <id>` and `--attach <url>`. The prompt is written to stdin and stdin is closed, so the prompt never appears in the process arguments and cannot be interpreted by a shell. The permission bypass flag is never included, regardless of what the probe found.

The runner reads the output line by line, parses each line with `parseOpenCodeEventLine`, and collects the normalized events. It captures the session id from the first event that carries one. On a non-zero exit it classifies the failure: a missing session is terminal, while a rate limit or a transient provider error is retryable. The classification is a lookup over the tool's stderr text, and an unrecognised failure is treated as terminal so the daemon does not retry indefinitely against a broken tool.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace @adam/daemon`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/daemon
git commit -m "feat(daemon): add opencode prompt execution and event normalization"
```

---

### Task 5: OpenCode permission forwarding and MCP injection

**Files:**
- Create: `apps/daemon/src/adapters/opencode/permissions.ts`
- Create: `apps/daemon/src/adapters/opencode/mcp-config.ts`
- Create: `apps/daemon/test/opencode-permissions.test.ts`
- Create: `apps/daemon/test/opencode-mcp-config.test.ts`

**Interfaces:**
- Consumes: the shared permission contracts from `@adam/contracts`, the `AdamAdapter` interface, and the relay's MCP endpoint configuration.
- Produces:
  - `toPermissionRequest(event: NormalizedOpenCodeEvent): PermissionRequest | null` — converts an OpenCode permission event into the shared permission request shape, or returns null when the event is not a permission request.
  - `buildOpenCodeConfigContent(options: OpenCodeMcpOptions): string` — returns the JSON configuration passed through `OPENCODE_CONFIG_CONTENT`.
  - `OpenCodeMcpOptions` — `{ mcpServers: Record<string, { type: "http"; url: string; headers?: Record<string, string> }> }`.
  - `OpenCodeAdapter` — an `AdamAdapter` implementation with the manifest `id` of `opencode`, `runtime` of `local_daemon`, risk tier `green`, and capabilities `detectSessions`, `resumeSession`, `startSession`, `sendPrompt`, `streamActivity`, `readHistory`, `readGitStatus`, and `requestPermissions` all true, with `writeFiles` and `runShell` false.

- [ ] **Step 1: Write the failing test**

Create `apps/daemon/test/opencode-permissions.test.ts`:

```ts
it("converts an opencode permission event into a shared permission request", () => {
  const request = toPermissionRequest({ kind: "permission", payload: { id: "p1", title: "Run npm install", kind: "bash" } });
  expect(request?.capability).toBe("run_shell");
  expect(request?.summary).toContain("npm install");
});

it("returns null for an event that is not a permission request", () => {
  expect(toPermissionRequest({ kind: "message", payload: {} })).toBeNull();
});
```

Create `apps/daemon/test/opencode-mcp-config.test.ts`:

```ts
it("injects the relay mcp server without touching the user's config", () => {
  const content = buildOpenCodeConfigContent({ mcpServers: { adam: { type: "http", url: "https://relay.example/mcp", headers: { Authorization: "Bearer token" } } } });
  const parsed = JSON.parse(content);
  expect(parsed.mcp.adam.type).toBe("http");
  expect(parsed.mcp.adam.url).toBe("https://relay.example/mcp");
});

it("does not write a config file", () => {
  buildOpenCodeConfigContent({ mcpServers: {} });
  expect(existsSync(path.join(workingDirectory, "opencode.json"))).toBe(false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace @adam/daemon`
Expected: FAIL with a module-not-found error for the adapter modules.

- [ ] **Step 3: Implement permission forwarding and MCP injection**

Create `apps/daemon/src/adapters/opencode/permissions.ts` with `toPermissionRequest`. It maps the OpenCode permission kinds onto the shared permission vocabulary: a bash or shell request becomes `run_shell`, a file edit becomes `write_files`, and anything else becomes `tool_call`. The request carries a summary built from the tool name and the command or path, which is what the phone shows.

Create `apps/daemon/src/adapters/opencode/mcp-config.ts` with `buildOpenCodeConfigContent`. It returns the JSON for the `mcp` section of OpenCode's configuration, with one entry per server, each carrying its type, URL, and headers. The function only returns a string; it never writes a file, so the user's own `opencode.json` is never modified.

Create `apps/daemon/src/adapters/opencode/index.ts` with the `OpenCodeAdapter` implementation. It composes detection, the server lifecycle, prompt execution, permission conversion, and MCP injection. When a prompt run produces a permission event, the adapter emits the shared `permission_request` event and waits for the matching `permission_decision` before continuing, rather than approving on the user's behalf.

Register the adapter in `apps/daemon/src/adapters/registry.ts`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace @adam/daemon`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm run ci`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/daemon
git commit -m "feat(daemon): add opencode adapter with permission forwarding and mcp injection"
```

---

### Task 6: Claude Code adapter with MCP permission host

**Files:**
- Create: `apps/daemon/src/adapters/claude-code/events.ts`
- Create: `apps/daemon/src/adapters/claude-code/prompt.ts`
- Create: `apps/daemon/src/adapters/claude-code/permission-tool.ts`
- Create: `apps/daemon/src/adapters/claude-code/index.ts`
- Create: `apps/daemon/test/claude-code-adapter.test.ts`

**Interfaces:**
- Consumes: the `AdamAdapter` interface, the shared event and permission contracts, and the relay's MCP server.
- Produces:
  - `parseClaudeCodeEventLine(line: string): NormalizedOpenCodeEvent | null` — normalizes one line of the `stream-json` output.
  - `runClaudeCodePrompt(options: ClaudeCodePromptOptions): Promise<ClaudeCodePromptResult>` — `ClaudeCodePromptOptions` is `{ binary: string; workingDirectory: string; prompt: string; sessionId?: string; permissionToolName: string; flags: ClaudeCodeFlags; env?: Record<string, string>; signal?: AbortSignal }`.
  - `ClaudeCodePromptResult` — `{ state: "adapter_sent" | "acknowledged" | "failed"; sessionId?: string; events: NormalizedOpenCodeEvent[]; error?: AdapterError }`.
  - `ClaudeCodeFlags` — `{ outputFormat: boolean; resume: boolean; continue: boolean; permissionPromptTool: boolean; permissionPrompts: boolean; permissionMode: boolean }`.
  - `CLAUDE_PERMISSION_TOOL_NAME` — the constant `"adam_permission_decision"`.
  - `ClaudeCodeAdapter` — an `AdamAdapter` with manifest `id` of `claude_code`, `runtime` of `local_daemon`, risk tier `green`, and capabilities `detectSessions`, `resumeSession`, `startSession`, `sendPrompt`, `streamActivity`, `readHistory`, and `requestPermissions` true, with `writeFiles` and `runShell` false.

- [ ] **Step 1: Write the failing test**

Create `apps/daemon/test/claude-code-adapter.test.ts`:

```ts
it("is a full adapter rather than ingestion only", () => {
  expect(adapter.manifest.runtime).toBe("local_daemon");
  expect(adapter.manifest.capabilities.sendPrompt).toBe(true);
  expect(adapter.manifest.capabilities.requestPermissions).toBe(true);
});

it("parses a stream-json assistant line", () => {
  const event = parseClaudeCodeEventLine(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "done" }] } }));
  expect(event?.kind).toBe("message");
});

it("captures the session id from the result", () => {
  const event = parseClaudeCodeEventLine(JSON.stringify({ type: "result", session_id: "sess_123" }));
  expect(event?.sessionId).toBe("sess_123");
});

it("passes the adam permission tool as the permission host", async () => {
  const recorder = fakeBinaryRecordingArgvAndStdin();
  await runClaudeCodePrompt({ binary: recorder.path, workingDirectory, prompt: "hi", permissionToolName: CLAUDE_PERMISSION_TOOL_NAME, flags });
  expect(recorder.argv).toContain("--permission-prompt-tool");
  expect(recorder.argv).toContain(CLAUDE_PERMISSION_TOOL_NAME);
});

it("never uses the permission bypass mode", async () => {
  const recorder = fakeBinaryRecordingArgvAndStdin();
  await runClaudeCodePrompt({ binary: recorder.path, workingDirectory, prompt: "hi", permissionToolName: CLAUDE_PERMISSION_TOOL_NAME, flags });
  const argv = recorder.argv.join(" ");
  expect(argv).not.toContain("--dangerously-skip-permissions");
  expect(argv).not.toContain("bypassPermissions");
});

it("does not disable permission prompts while a host is reachable", async () => {
  const recorder = fakeBinaryRecordingArgvAndStdin();
  await runClaudeCodePrompt({ binary: recorder.path, workingDirectory, prompt: "hi", permissionToolName: CLAUDE_PERMISSION_TOOL_NAME, flags });
  expect(recorder.argv.join(" ")).not.toContain("--permission-prompts");
});

it("surfaces a permission denial from the stream", async () => {
  const recorder = fakeBinaryPrintingLines([
    JSON.stringify({ type: "system", subtype: "permission_denied", tool_name: "Bash" }),
  ]);
  const result = await runClaudeCodePrompt({ binary: recorder.path, workingDirectory, prompt: "hi", permissionToolName: CLAUDE_PERMISSION_TOOL_NAME, flags });
  expect(result.events.some((event) => event.kind === "permission")).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace @adam/daemon`
Expected: FAIL with a module-not-found error for `../src/adapters/claude-code/index.js`.

- [ ] **Step 3: Implement the adapter**

Create `apps/daemon/src/adapters/claude-code/events.ts`. `parseClaudeCodeEventLine` parses one line as JSON and maps the documented `stream-json` event types: assistant and user messages become `message`, tool calls become `tool`, permission denials become `permission`, the result event becomes `session` and contributes the session id. A line that is not valid JSON returns null. An unrecognised event type becomes `unsupported` rather than throwing.

Create `apps/daemon/src/adapters/claude-code/prompt.ts`. `runClaudeCodePrompt` spawns the binary with `-p`, `--output-format stream-json`, and `--verbose`. When a session id is supplied it adds `--resume <id>`. When the installed build supports it, it adds `--permission-prompt-tool <adam_permission_decision>`, which is what turns the relay's MCP server into the permission host.

The prompt is passed as the `-p` argument only when the tool requires it, and the run never passes `--dangerously-skip-permissions` or `--permission-mode bypassPermissions`. It never passes `--permission-prompts none` while the relay's permission tool is reachable, because that flag converts an approval into a denial.

Create `apps/daemon/src/adapters/claude-code/permission-tool.ts` with `CLAUDE_PERMISSION_TOOL_NAME` and the handler that the relay registers. The handler receives a tool request carrying the tool name and the command or path, converts it into the shared `permission_request` event, waits for the matching `permission_decision`, and returns the decision to the tool.

Create `apps/daemon/src/adapters/claude-code/index.ts` with the `ClaudeCodeAdapter` implementation, and register it in `apps/daemon/src/adapters/registry.ts`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace @adam/daemon`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/daemon
git commit -m "feat(daemon): add claude code adapter using an mcp permission host"
```

---

### Task 7: GitHub Copilot CLI adapter

**Files:**
- Create: `apps/daemon/src/adapters/copilot/events.ts`
- Create: `apps/daemon/src/adapters/copilot/prompt.ts`
- Create: `apps/daemon/src/adapters/copilot/index.ts`
- Create: `apps/daemon/test/copilot-adapter.test.ts`

**Interfaces:**
- Consumes: the `AdamAdapter` interface and the shared event contracts.
- Produces:
  - `parseCopilotEventLine(line: string): NormalizedOpenCodeEvent | null` — normalizes one line of the JSONL output.
  - `runCopilotPrompt(options: CopilotPromptOptions): Promise<CopilotPromptResult>` — `CopilotPromptOptions` is `{ binary: string; workingDirectory: string; prompt: string; sessionId?: string; connect?: boolean; flags: CopilotFlags; env?: Record<string, string>; signal?: AbortSignal }`.
  - `CopilotFlags` — `{ outputFormat: boolean; resume: boolean; connect: boolean; share: boolean; trustFolder: boolean; noAskUser: boolean }`.
  - `CopilotAdapter` — an `AdamAdapter` with manifest `id` of `github_copilot_cli`, `runtime` of `local_daemon`, risk tier `green`, and capabilities `detectSessions`, `resumeSession`, `sendPrompt`, `streamActivity`, and `readHistory` true, with `writeFiles` and `runShell` false.

- [ ] **Step 1: Write the failing test**

Create `apps/daemon/test/copilot-adapter.test.ts`:

```ts
it("runs in prompt mode with structured output", async () => {
  const recorder = fakeBinaryRecordingArgvAndStdin();
  await runCopilotPrompt({ binary: recorder.path, workingDirectory, prompt: "hi", flags });
  expect(recorder.argv).toContain("-p");
  expect(recorder.argv).toContain("--output-format");
  expect(recorder.argv).toContain("json");
});

it("reconnects to a running session when asked to", async () => {
  const recorder = fakeBinaryRecordingArgvAndStdin();
  await runCopilotPrompt({ binary: recorder.path, workingDirectory, prompt: "hi", sessionId: "sess_1", connect: true, flags });
  expect(recorder.argv).toContain("--connect");
});

it("never combines trust-folder with a resumed session", async () => {
  const recorder = fakeBinaryRecordingArgvAndStdin();
  await runCopilotPrompt({ binary: recorder.path, workingDirectory, prompt: "hi", sessionId: "sess_1", flags });
  expect(recorder.argv.join(" ")).not.toContain("--trust-folder");
});

it("parses a copilot event line", () => {
  const event = parseCopilotEventLine(JSON.stringify({ type: "assistant", content: "hello" }));
  expect(event?.kind).toBe("message");
});

it("skips an event type it does not understand", () => {
  expect(parseCopilotEventLine("not json")).toBeNull();
});

it("reports that mcp was skipped when the oauth handler was absent", async () => {
  const recorder = fakeBinaryPrintingLines([JSON.stringify({ type: "warning", message: "skipping MCP connections" })]);
  const result = await runCopilotPrompt({ binary: recorder.path, workingDirectory, prompt: "hi", flags });
  expect(result.events.some((event) => event.kind === "unsupported")).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace @adam/daemon`
Expected: FAIL with a module-not-found error for `../src/adapters/copilot/index.js`.

- [ ] **Step 3: Implement the adapter**

Create `apps/daemon/src/adapters/copilot/events.ts`. `parseCopilotEventLine` parses one line of the JSONL output and maps the documented event types to normalized kinds. A line that is not valid JSON returns null, and an unrecognised type becomes `unsupported` so the daemon records that the tool produced something the adapter does not understand. This is how the skipped-MCP warning becomes visible instead of silently reducing the agent's capabilities.

Create `apps/daemon/src/adapters/copilot/prompt.ts`. `runCopilotPrompt` spawns the binary with `-p`, `--output-format json`, and `--silent` so the output carries only the agent's events. When a session id is supplied it adds `--resume <id>`. When the run is reconnecting to an existing session it uses `--connect <session-id>`, which is the flag the tool documents for remote control. The adapter never passes `--trust-folder` alongside a resumed session, because the two are mutually exclusive in the tool and because trusting a directory's hooks and MCP servers requires the user to have reviewed them.

Create `apps/daemon/src/adapters/copilot/index.ts` with the `CopilotAdapter` implementation, and register it in `apps/daemon/src/adapters/registry.ts`. The adapter never reads the local Copilot session store.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace @adam/daemon`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm run ci`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/daemon
git commit -m "feat(daemon): add github copilot cli adapter with remote reconnection"
```
