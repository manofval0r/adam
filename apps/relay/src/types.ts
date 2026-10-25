import type { AdamEventType, EventEnvelope } from "@adam/contracts";

export type DeviceStatus = "paired" | "connected" | "disconnected" | "revoked";

export type SessionStatus = "active" | "idle" | "failed" | "disconnected";
export type PromptDeliveryState =
  | "queued"
  | "relay_received"
  | "daemon_received"
  | "adapter_sent"
  | "acknowledged"
  | "failed";

/**
 * Event types the relay emits.
 *
 * The relay speaks a subset of the shared event vocabulary, so the subset is
 * derived from the shared union instead of being spelled out again.
 */
export type RelayEventType = Extract<
  AdamEventType,
  "message" | "activity" | "prompt_delivery" | "error"
>;

export interface RelayUser {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface RelayDevice {
  id: string;
  userId: string;
  name: string;
  tokenHash: string;
  tokenExpiresAt: string;
  status: DeviceStatus;
  reconnectCount: number;
  lastHeartbeatAt?: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
}

export interface PairingCodeRecord {
  code: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  usedByDeviceId?: string;
}

export interface RelaySession {
  relaySessionId: string;
  id: string;
  userId: string;
  deviceId: string;
  tool: "codex_cli" | "unknown";
  repoPath?: string;
  branch?: string;
  remotePromptConsent: boolean;
  status: SessionStatus;
  lastActivityAt: string;
  updatedAt: string;
}

export interface RelayPrompt {
  id: string;
  userId: string;
  deviceId: string;
  sessionId: string;
  text: string;
  state: PromptDeliveryState;
  deliveryAttemptCount: number;
  createdAt: string;
  updatedAt: string;
  dequeuedAt?: string;
  leaseExpiresAt?: string;
  completedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  assistantText?: string;
  clientPromptId?: string;
}

export interface PromptStatusUpdateInput {
  state: "adapter_sent" | "acknowledged" | "failed";
  errorCode?: string;
  errorMessage?: string;
  assistantText?: string;
}

export interface RelayMessageEventPayload {
  role: "user" | "assistant" | "system";
  text: string;
  format: "plain_text" | "markdown";
  promptId?: string;
}

export interface RelayActivityEventPayload {
  title: string;
  body?: string;
  status: "started" | "in_progress" | "completed" | "blocked" | "failed";
  category: "syncing" | "waiting" | "other";
  promptId?: string;
}

export interface RelayPromptDeliveryPayload {
  promptId: string;
  state: PromptDeliveryState;
  errorCode?: string;
  errorMessage?: string;
}

export interface RelayErrorEventPayload {
  code: string;
  message: string;
  severity: "warning" | "error" | "critical";
  retryable: boolean;
  promptId?: string;
}

/**
 * A relay event: the shared event envelope plus the user it belongs to.
 *
 * The payload stays relay-local until the shared package grows payload
 * schemas for it; the envelope around it is the shared one.
 */
export type RelayEvent = Omit<EventEnvelope, "type" | "payload"> & {
  userId: string;
  type: RelayEventType;
  payload:
    | RelayMessageEventPayload
    | RelayActivityEventPayload
    | RelayPromptDeliveryPayload
    | RelayErrorEventPayload;
};

export interface SessionHeartbeatInput {
  id: string;
  tool: "codex_cli" | "unknown";
  status: SessionStatus;
  repoPath?: string;
  branch?: string;
  lastActivityAt?: string;
  remotePromptConsent?: boolean;
}

export interface DaemonHeartbeatInput {
  daemonVersion: string;
  sessions: SessionHeartbeatInput[];
}

export interface QueuedPrompt {
  promptId: string;
  sessionId: string;
  text: string;
  createdAt: string;
  leaseExpiresAt: string;
  correlationId: string;
}

export interface RelayConfig {
  environment: "production" | "development" | "test";
  host: string;
  port: number;
  pairingCodeTtlSeconds: number;
  heartbeatStaleSeconds: number;
  promptLeaseSeconds: number;
  deviceTokenTtlDays: number;
  enforceTlsInProduction: boolean;
  trustProxy: boolean;
  trustedProxyIps: string[];
  allowInMemoryStoreInProduction: boolean;
  bootstrapApiKey: string;
}
