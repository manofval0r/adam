export type DaemonEventType = "session_started" | "activity";

export type EventVisibility = "user_visible" | "collapsed" | "audit_only" | "hidden";

export type EventRetentionClass = "ephemeral" | "standard" | "audit" | "artifact_pointer";

export interface EventRetention {
  class: EventRetentionClass;
  ttlDays?: number;
}

export interface EventSource {
  kind: "desktop_daemon";
  id: string;
  name: string;
  version: string;
}

export interface EventActor {
  kind: "system";
  id: string;
  displayName: string;
}

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

export interface DaemonEventEnvelope<TPayload> {
  id: string;
  schemaVersion: "2026-07-26";
  type: DaemonEventType;
  sessionId: string;
  sequence: number;
  createdAt: string;
  source: EventSource;
  actor: EventActor;
  payload: TPayload;
  visibility: EventVisibility;
  retention: EventRetention;
}

export type DaemonEvent =
  | DaemonEventEnvelope<SessionStartedPayload>
  | DaemonEventEnvelope<ActivityPayload>;
