export type DeviceStatus = "paired" | "connected" | "disconnected" | "revoked";

export type SessionStatus = "active" | "idle" | "failed" | "disconnected";

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
  id: string;
  userId: string;
  deviceId: string;
  tool: "codex_cli" | "unknown";
  repoPath?: string;
  branch?: string;
  status: SessionStatus;
  lastActivityAt: string;
  updatedAt: string;
}

export interface SessionHeartbeatInput {
  id: string;
  tool: "codex_cli" | "unknown";
  status: SessionStatus;
  repoPath?: string;
  branch?: string;
  lastActivityAt?: string;
}

export interface DaemonHeartbeatInput {
  daemonVersion: string;
  sessions: SessionHeartbeatInput[];
}

export interface RelayConfig {
  environment: "production" | "development" | "test";
  host: string;
  port: number;
  pairingCodeTtlSeconds: number;
  heartbeatStaleSeconds: number;
  deviceTokenTtlDays: number;
  enforceTlsInProduction: boolean;
  trustProxy: boolean;
  trustedProxyIps: string[];
  allowInMemoryStoreInProduction: boolean;
  bootstrapApiKey: string;
}
