import type {
  AdamEventType,
  EventActor,
  EventEnvelope,
  EventRetention,
  EventRetentionClass,
  EventSource,
  EventVisibility
} from "@adam/contracts";

export type {
  EventActor,
  EventRetention,
  EventRetentionClass,
  EventSource,
  EventVisibility
};

/**
 * Event types the daemon can emit.
 *
 * The vocabulary is owned by `@adam/contracts`; the daemon only narrows it
 * when it pairs one event type with one daemon-local payload.
 */
export type DaemonEventType = AdamEventType;

export interface SessionStartedPayload {
  tool: "codex_cli" | "unknown";
  adapterSessionId?: string;
  repoPath?: string;
  branch?: string;
  mode: "detected" | "resumed" | "created";
}

export interface ActivityPayload {
  title: string;
  body?: string;
  status: "started" | "in_progress" | "completed" | "blocked" | "failed";
  category: "syncing" | "searching" | "other";
}

export interface SessionHeartbeatInput {
  id: string;
  tool: "codex_cli" | "unknown";
  status: "active" | "idle" | "failed" | "disconnected";
  repoPath?: string;
  branch?: string;
  lastActivityAt?: string;
  remotePromptConsent?: boolean;
}

export interface DaemonHeartbeatInput {
  daemonVersion: string;
  sessions: SessionHeartbeatInput[];
}

/**
 * The shared event envelope, narrowed to one event type.
 *
 * The envelope fields are derived from the shared `EventEnvelope`, so a field
 * added to the shared contract cannot be missing here. The event type is a type
 * parameter so that widening `DaemonEventType` to the shared union cannot pair
 * an arbitrary payload with an arbitrary type.
 */
export type DaemonEventEnvelope<TType extends DaemonEventType, TPayload> = Omit<
  EventEnvelope,
  "type" | "payload"
> & {
  type: TType;
  payload: TPayload;
};

export type DaemonEvent =
  | DaemonEventEnvelope<"session_started", SessionStartedPayload>
  | DaemonEventEnvelope<"activity", ActivityPayload>;
