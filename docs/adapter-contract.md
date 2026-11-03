# Adapter Contract

This document defines how Adam talks to coding-agent tools such as Codex CLI, Claude Code, GitHub Copilot exports, and future integrations. Adapters convert vendor-specific activity into the normalized event schema and expose safe control operations back to Adam.

## Goals

1. Keep tool-specific logic outside the relay, web app, and mobile app.
2. Allow ingestion-only integrations without pretending every tool can be controlled remotely.
3. Make capabilities explicit so clients can show only safe actions.
4. Require permission gates before shell, file, repo, network, system, or secrets access.
5. Support local daemon adapters first, then cloud-runner adapters later.

## Adapter shape

```ts
type AdamAdapter = {
  manifest: AdapterManifest;
  detect(context: AdapterDetectContext): Promise<AdapterDetectResult>;
  start?(context: AdapterStartContext): Promise<AdapterSession>;
  resume?(context: AdapterResumeContext): Promise<AdapterSession>;
  stop?(context: AdapterStopContext): Promise<void>;
  sendPrompt?(context: AdapterPromptContext): Promise<AdapterPromptResult>;
  subscribe(context: AdapterSubscribeContext): AsyncIterable<AdapterEventBatch>;
  getHealth(context: AdapterHealthContext): Promise<AdapterHealth>;
};
```

## Adapter manifest

```ts
type AdapterManifest = {
  id: "codex_cli" | "opencode" | "claude_code" | "github_copilot_cli" | "github_copilot_export" | string;
  displayName: string;
  version: string;
  riskTier: "green" | "yellow" | "red";
  runtime: "local_daemon" | "cloud_runner" | "import_only";
  capabilities: AdapterCapabilities;
};

type AdapterCapabilities = {
  detectSessions: boolean;
  resumeSession: boolean;
  startSession: boolean;
  sendPrompt: boolean;
  streamActivity: boolean;
  readHistory: boolean;
  readGitStatus: boolean;
  writeFiles: boolean;
  runShell: boolean;
  requestPermissions: boolean;
};
```

## MVP Codex CLI capability target

| Capability | MVP target |
| --- | --- |
| Detect Codex CLI availability | Yes |
| Detect one active/local session | Yes |
| Resume one session | Yes, if supported safely by Codex CLI behavior |
| Send prompt | Yes |
| Stream normalized activity | Yes, at least message/activity/tool state where available |
| Read git status | Yes, through daemon git integration |
| Write files directly from Adam | No; Codex/tool owns edits |
| Run arbitrary shell from mobile | No direct mobile shell in MVP; require explicit permission events later |
| Cloud runner support | Later |

## OpenCode adapter capability target

OpenCode is the second full adapter and the first that is driven as a long-lived client rather than spawned per prompt. It is MIT licensed and exposes a documented JSON event stream, so it is green tier.

| Capability | Target |
| --- | --- |
| Detect OpenCode availability | Yes |
| Detect local sessions | Yes, through `opencode session list --format json` |
| Resume one session | Yes, through `--session <id>` |
| Send prompt | Yes, through `opencode run --format json` with the prompt on stdin |
| Stream normalized activity | Yes, from the raw JSON event stream |
| Read git status | Yes, through daemon git integration |
| Read history | Yes, through `opencode export <id>` rather than reading the session database |
| Run a long-lived tool server | Yes, through `opencode serve` plus `--attach` |
| Request permissions | Yes, by forwarding OpenCode's own approval flow to the phone |
| Write files directly from Adam | No; the agent owns edits |
| Run arbitrary shell from mobile | No; shell runs inside the agent under its own approval flow |

### Server-backed adapters

Some tools separate the agent engine from its clients. OpenCode runs a headless HTTP server that the terminal UI, desktop app, and editor extensions all connect to, and a run can attach to an already-running server.

An adapter for such a tool keeps one server process alive on the user's machine and drives it over its local interface. This has two concrete benefits for Adam. The MCP connection from the tool to Adam's connector hub stays open, so the connector's OAuth handshake is not repeated on every prompt. And the tool's session state persists in the server, so resuming a session does not require reconstructing it from exported history.

The adapter must still handle the case where the server is not running, by starting one and attaching to it.

### Flag detection

Tool CLIs add flags between releases. `opencode run --dangerously-skip-permissions` exists in newer builds and not in older ones. An adapter probes `opencode run --help` at detection time and records the available flags, rather than assuming a fixed set. Adam never passes a flag that suppresses the tool's own permission flow, because forwarding that approval to the phone is the product.

## Lifecycle

### Detection

`detect` checks whether the tool is installed and whether a relevant session can be found.

```ts
type AdapterDetectContext = {
  workingDirectory: string;
  environment: "local" | "cloud";
};

type AdapterDetectResult = {
  available: boolean;
  toolVersion?: string;
  sessions: Array<{
    adapterSessionId: string;
    title?: string;
    workingDirectory?: string;
    lastSeenAt?: string;
    state: "active" | "idle" | "stopped" | "unknown";
  }>;
  errors?: Array<AdapterError>;
};
```

### Start or resume

Adapters should only expose start/resume when the underlying tool has a safe control surface.

```ts
type AdapterSession = {
  adapterSessionId: string;
  adamSessionId: string;
  state: "active" | "idle" | "stopped" | "failed";
  startedAt?: string;
  workingDirectory?: string;
};
```

### Prompt delivery

`sendPrompt` accepts a user prompt and returns delivery state. It must not report success until the prompt reaches the adapter/tool boundary.

```ts
type AdapterPromptContext = {
  adamSessionId: string;
  adapterSessionId: string;
  promptId: string;
  text: string;
  requestedBy: string;
};

type AdapterPromptResult = {
  promptId: string;
  state: "adapter_sent" | "acknowledged" | "failed";
  error?: AdapterError;
};
```

### Event subscription

Adapters emit batches of normalized events. The daemon handles local persistence and relay delivery.

```ts
type AdapterEventBatch = {
  adapterSessionId: string;
  events: Array<AdamEvent<AdamEventType, unknown>>;
  cursor?: string;
};
```

## Permission boundary

Adapters must not silently perform dangerous actions on Adam's behalf. If an action requires user approval, the adapter or daemon emits `permission_request`, then waits for `permission_decision`.

| Capability | Permission requirement |
| --- | --- |
| Read current repo status | Allowed after project pairing. |
| Read full file contents | Requires filesystem permission if surfaced outside local agent context. |
| Write files directly | Requires filesystem/repo permission and should be avoided in MVP. |
| Run shell/PowerShell | Requires shell permission with command preview. |
| Network calls outside relay/tool defaults | Requires network permission. |
| Read secrets/env files | Requires secrets permission and should be blocked by default. |
| Push branches or mutate PRs | Requires repo permission. |

## Health contract

```ts
type AdapterHealth = {
  status: "healthy" | "degraded" | "unavailable";
  checkedAt: string;
  message?: string;
  details?: Record<string, unknown>;
};

type AdapterError = {
  code: string;
  message: string;
  retryable: boolean;
};
```

## Storage contract

- Adapters should not write directly to the cloud database.
- Local adapters write through the desktop daemon's local event queue.
- Cloud-runner adapters write through the runner supervisor.
- Large outputs become `artifact` events with storage pointers.
- Adapter cursors should be persisted so ingestion can resume after disconnects.

## Risk tiers

| Tier | Adapter behavior |
| --- | --- |
| Green | Official CLI/API/export/documented format. Safe for MVP if permission model is respected. |
| Yellow | Undocumented local files or unstable formats. Ingestion-only until legal/safety review. |
| Red | Reverse engineering, hidden service calls, scraping, bypassing terms, or uncontrolled mutation. Do not ship. |

## First adapter implementation order

1. Codex CLI local adapter.
2. OpenCode local adapter, in server-backed mode.
3. Claude Code local adapter, using an MCP tool as the permission host.
4. GitHub Copilot CLI local adapter, reconnecting with `--connect`.
5. Copy-paste fallback importer.
6. Cloud-runner adapter once hosted or user-owned runner architecture is ready.

## Permission host adapters

Claude Code can be given an MCP tool as the host that answers permission requests, through its `--permission-prompt-tool` flag. An Agent SDK application can do the same through a `canUseTool` callback.

This is the mechanism Adam should use rather than a bespoke one. The relay already exposes an MCP server, so the permission tool is another tool on that server: it converts the tool's permission request into a shared `permission_request` event, waits for the matching `permission_decision` from the phone, and returns the answer to the agent.

The consequence is that the phone-facing approval flow is written once. An agent that supports an MCP permission host needs no adapter-specific approval code, only a manifest entry naming the tool. Adapters that cannot offer a host, such as a pure ingestion adapter, must still declare `requestPermissions` as false rather than pretending to support it.

