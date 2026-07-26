# Normalized Event Schema

This document defines Adam's implementation-ready event model. Every daemon, adapter, relay, web client, mobile client, and future cloud runner should use this schema as the shared language for session state, activity, permissions, artifacts, repository changes, and delivery status.

## Goals

1. Keep every coding-agent integration behind one common event stream.
2. Make events durable enough for offline retry and replay.
3. Support local-first MVP behavior without blocking future cloud execution.
4. Keep user approval, file changes, and agent activity auditable.
5. Avoid storing large payloads inline when artifacts can be referenced by URI.

## Event envelope

All event types share this envelope.

```ts
type AdamEvent<TType extends AdamEventType, TPayload> = {
  id: string;
  schemaVersion: "2026-07-26";
  type: TType;
  sessionId: string;
  sequence: number;
  createdAt: string;
  source: EventSource;
  actor: EventActor;
  correlationId?: string;
  parentEventId?: string;
  payload: TPayload;
  visibility: EventVisibility;
  retention: EventRetention;
};
```

| Field | Requirement |
| --- | --- |
| `id` | Globally unique event id, preferably ULID for sortable creation order. |
| `schemaVersion` | Required version string. Breaking changes must introduce a new version. |
| `type` | One normalized event type from the table below. |
| `sessionId` | Adam session id, not the vendor tool's raw session id. |
| `sequence` | Monotonic per-session integer assigned by the event producer or relay. |
| `createdAt` | ISO 8601 timestamp from the producer. Relay may add received timestamps separately. |
| `source` | Where the event came from: daemon, relay, client, adapter, GitHub, CI, or cloud runner. |
| `actor` | The human, assistant, system, adapter, or external service responsible for the event. |
| `correlationId` | Optional id tying a prompt, delivery state, tool call, and result together. |
| `parentEventId` | Optional parent event id for replies, approvals, artifacts, or child activity. |
| `payload` | Event-specific payload. |
| `visibility` | Controls whether the event is shown to the user, hidden, or admin/audit-only. |
| `retention` | Retention hint used by Adam-hosted and bring-your-own storage connectors. |

## Supporting types

```ts
type AdamEventType =
  | "session_started"
  | "message"
  | "activity"
  | "tool_call"
  | "permission_request"
  | "permission_decision"
  | "decision_request"
  | "decision_response"
  | "file_change"
  | "diff"
  | "artifact"
  | "git_event"
  | "ci_event"
  | "prompt_delivery"
  | "error"
  | "session_ended";

type EventSource = {
  kind: "desktop_daemon" | "cloud_relay" | "web_client" | "mobile_client" | "adapter" | "github" | "ci" | "cloud_runner";
  id?: string;
  name?: string;
  version?: string;
};

type EventActor = {
  kind: "user" | "assistant" | "system" | "adapter" | "github" | "ci";
  id?: string;
  displayName?: string;
};

type EventVisibility = "user_visible" | "collapsed" | "audit_only" | "hidden";

type EventRetention = {
  class: "ephemeral" | "standard" | "audit" | "artifact_pointer";
  ttlDays?: number;
};
```

## MVP event types

### `session_started`

Emitted when Adam detects, creates, resumes, or connects to an agent session.

```ts
type SessionStartedPayload = {
  tool: "codex_cli" | "claude_code" | "github_copilot" | "unknown";
  adapterSessionId?: string;
  repo?: RepoRef;
  branch?: string;
  workingDirectory?: string;
  mode: "detected" | "created" | "resumed" | "connected";
};
```

### `message`

Represents user or assistant text shown in the feed.

```ts
type MessagePayload = {
  role: "user" | "assistant" | "system";
  text: string;
  format: "plain_text" | "markdown";
  deliveryState?: "queued" | "sent" | "acknowledged" | "failed";
};
```

### `activity`

Plain-language activity for the mobile/web feed.

```ts
type ActivityPayload = {
  title: string;
  body?: string;
  status: "started" | "in_progress" | "completed" | "blocked" | "failed";
  category: "planning" | "editing" | "testing" | "searching" | "waiting" | "syncing" | "other";
};
```

### `tool_call`

Captures a command or tool invocation without requiring full terminal output inline.

```ts
type ToolCallPayload = {
  toolName: string;
  commandPreview?: string;
  status: "started" | "completed" | "failed" | "cancelled";
  exitCode?: number;
  startedAt?: string;
  endedAt?: string;
  artifactIds?: string[];
};
```

### `permission_request`

Used when an agent needs explicit user consent.

```ts
type PermissionRequestPayload = {
  permissionId: string;
  capability: "shell" | "powershell" | "filesystem" | "repo" | "network" | "system" | "secrets";
  title: string;
  reason: string;
  risk: "low" | "medium" | "high" | "dangerous";
  requestedActionPreview?: string;
  expiresAt?: string;
};
```

### `permission_decision`

Records approval or rejection.

```ts
type PermissionDecisionPayload = {
  permissionId: string;
  decision: "approved" | "rejected" | "expired";
  decidedBy: string;
  decidedAt: string;
  scope: "once" | "session" | "project";
  note?: string;
};
```

### `decision_request`

Used when the agent needs product, design, or implementation guidance.

```ts
type DecisionRequestPayload = {
  decisionId: string;
  title: string;
  question: string;
  options?: Array<{
    id: string;
    label: string;
    description?: string;
    recommended?: boolean;
  }>;
  freeformAllowed: boolean;
  expiresAt?: string;
};
```

### `decision_response`

Records the user's guidance.

```ts
type DecisionResponsePayload = {
  decisionId: string;
  selectedOptionId?: string;
  text?: string;
  decidedBy: string;
  decidedAt: string;
};
```

### `file_change`

Summarizes changed files for mobile/web display.

```ts
type FileChangePayload = {
  path: string;
  changeType: "created" | "modified" | "deleted" | "renamed";
  previousPath?: string;
  language?: string;
  additions?: number;
  deletions?: number;
};
```

### `diff`

References a renderable diff. Large diffs should be stored as artifacts instead of inline payloads.

```ts
type DiffPayload = {
  format: "unified";
  filesChanged: number;
  additions?: number;
  deletions?: number;
  inlineDiff?: string;
  artifactId?: string;
};
```

### `artifact`

Points to generated outputs, logs, screenshots, reports, or summaries.

```ts
type ArtifactPayload = {
  artifactId: string;
  kind: "summary" | "plan" | "log" | "screenshot" | "report" | "diff" | "generated_file" | "other";
  title: string;
  mimeType?: string;
  sizeBytes?: number;
  storage: "adam_hosted" | "user_owned" | "local_only" | "github";
  uri?: string;
  previewText?: string;
};
```

### `git_event`

Captures branch, commit, status, push, pull request, and review activity.

```ts
type GitEventPayload = {
  action: "status" | "branch_changed" | "commit_created" | "pushed" | "pr_opened" | "pr_updated" | "review_received" | "merged";
  repo: RepoRef;
  branch?: string;
  commitSha?: string;
  pullRequest?: {
    number: number;
    url: string;
    state: "open" | "closed" | "merged" | "draft";
  };
  summary?: string;
};
```

### `ci_event`

Captures workflow/build/test/deployment status.

```ts
type CiEventPayload = {
  provider: "github_actions" | "other";
  workflowName?: string;
  runId?: string;
  status: "queued" | "in_progress" | "success" | "failure" | "cancelled" | "skipped";
  url?: string;
  summary?: string;
};
```

### `prompt_delivery`

Tracks remote prompt delivery through client, relay, daemon, and adapter.

```ts
type PromptDeliveryPayload = {
  promptId: string;
  state: "queued" | "relay_received" | "daemon_received" | "adapter_sent" | "acknowledged" | "failed";
  errorCode?: string;
  errorMessage?: string;
};
```

### `error`

Captures failures without pretending they are successful activity.

```ts
type ErrorPayload = {
  code: string;
  message: string;
  severity: "info" | "warning" | "error" | "critical";
  retryable: boolean;
  details?: Record<string, unknown>;
};
```

### `session_ended`

Emitted when the agent session stops, completes, fails, or goes idle.

```ts
type SessionEndedPayload = {
  reason: "completed" | "stopped" | "failed" | "idle" | "disconnected";
  summary?: string;
  errorCode?: string;
};
```

## Shared references

```ts
type RepoRef = {
  provider: "github";
  owner: string;
  name: string;
  defaultBranch?: string;
  url?: string;
};
```

## Delivery semantics

- The daemon must persist outbound events locally before sending them to the relay.
- The relay must deduplicate by `id`.
- Clients should order events by `sequence`, then `createdAt`, then `id`.
- Retryable delivery failures should emit `prompt_delivery` or `error` events instead of silently disappearing.
- Large terminal logs, screenshots, generated files, and long diffs should be artifacts with pointers, not inline event payloads.

## Storage and retention rules

- MVP local daemon events are stored in SQLite.
- MVP relay events are stored in Postgres/Supabase with conservative limits.
- Free/light Adam-hosted storage should prefer `standard` retention with short TTLs for non-audit events.
- Audit events for permissions and decisions should use `audit` retention.
- Bring-your-own storage connectors may retain longer histories, but Adam should still store enough metadata to show delivery and sync state.
