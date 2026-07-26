import { randomBytes, randomUUID } from "node:crypto";
import { hashToken } from "./auth.js";
import { RelayStoreError } from "./errors.js";
import type {
  DaemonHeartbeatInput,
  PairingCodeRecord,
  RelayConfig,
  RelayDevice,
  RelaySession,
  RelayUser
} from "./types.js";

export interface RelayStoreOptions {
  now?: () => Date;
}

export interface HeartbeatWriteResult {
  deviceId: string;
  reconnectCount: number;
  sessionsUpdated: number;
}

function toIso(date: Date): string {
  return date.toISOString();
}

function plusSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1_000);
}

function plusDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1_000);
}

export class RelayStore {
  private readonly users = new Map<string, RelayUser>();
  private readonly devices = new Map<string, RelayDevice>();
  private readonly sessions = new Map<string, RelaySession>();
  private readonly pairingCodes = new Map<string, PairingCodeRecord>();
  private readonly deviceTokenHashes = new Map<string, string>();
  private readonly now: () => Date;

  constructor(
    private readonly config: RelayConfig,
    options?: RelayStoreOptions
  ) {
    this.now = options?.now ?? (() => new Date());
  }

  upsertUser(userId: string, name?: string): RelayUser {
    const now = this.now();
    const existing = this.users.get(userId);
    if (existing) {
      if (name && name !== existing.name) {
        existing.name = name;
      }
      existing.updatedAt = toIso(now);
      return existing;
    }

    const user: RelayUser = {
      id: userId,
      name: name ?? userId,
      createdAt: toIso(now),
      updatedAt: toIso(now)
    };
    this.users.set(userId, user);
    return user;
  }

  issuePairingCode(userId: string, userName?: string): PairingCodeRecord {
    this.cleanupExpiredPairingCodes();
    this.upsertUser(userId, userName);
    const now = this.now();
    let code = "";

    do {
      code = randomBytes(4).toString("hex").toUpperCase();
    } while (this.pairingCodes.has(code));

    const record: PairingCodeRecord = {
      code,
      userId,
      createdAt: toIso(now),
      expiresAt: toIso(plusSeconds(now, this.config.pairingCodeTtlSeconds))
    };
    this.pairingCodes.set(code, record);
    return record;
  }

  exchangePairingCode(pairingCode: string, deviceName: string): {
    device: RelayDevice;
    deviceToken: string;
  } {
    const now = this.now();
    const record = this.pairingCodes.get(pairingCode.toUpperCase());
    if (!record) {
      throw new RelayStoreError("Pairing code not found.", 404, "pairing_code_not_found");
    }
    if (record.usedAt) {
      throw new RelayStoreError("Pairing code was already used.", 409, "pairing_code_already_used");
    }
    if (new Date(record.expiresAt).getTime() <= now.getTime()) {
      throw new RelayStoreError("Pairing code expired.", 410, "pairing_code_expired");
    }

    const deviceToken = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(deviceToken);
    const deviceId = `dev_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

    const device: RelayDevice = {
      id: deviceId,
      userId: record.userId,
      name: deviceName,
      tokenHash,
      tokenExpiresAt: toIso(plusDays(now, this.config.deviceTokenTtlDays)),
      status: "paired",
      reconnectCount: 0,
      createdAt: toIso(now),
      updatedAt: toIso(now)
    };

    this.devices.set(deviceId, device);
    this.deviceTokenHashes.set(tokenHash, deviceId);

    record.usedAt = toIso(now);
    record.usedByDeviceId = deviceId;

    return {
      device,
      deviceToken
    };
  }

  authenticateDeviceToken(token: string): RelayDevice {
    const tokenHash = hashToken(token);
    const deviceId = this.deviceTokenHashes.get(tokenHash);
    if (!deviceId) {
      throw new RelayStoreError("Invalid device token.", 401, "invalid_device_token");
    }

    const device = this.devices.get(deviceId);
    if (!device) {
      throw new RelayStoreError("Device not found.", 401, "invalid_device_token");
    }
    if (device.revokedAt || device.status === "revoked") {
      throw new RelayStoreError("Device token revoked.", 403, "revoked_device_token");
    }
    if (new Date(device.tokenExpiresAt).getTime() <= this.now().getTime()) {
      throw new RelayStoreError("Device token expired.", 401, "expired_device_token");
    }

    return device;
  }

  recordHeartbeat(deviceId: string, heartbeat: DaemonHeartbeatInput): HeartbeatWriteResult {
    this.refreshConnectivity();

    const now = this.now();
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new RelayStoreError("Device not found.", 404, "device_not_found");
    }
    if (device.status === "revoked") {
      throw new RelayStoreError("Device revoked.", 403, "revoked_device_token");
    }

    const wasDisconnected = device.status === "disconnected";
    device.status = "connected";
    device.lastHeartbeatAt = toIso(now);
    device.updatedAt = toIso(now);
    if (wasDisconnected) {
      device.reconnectCount += 1;
    }

    const incomingSessionIds = new Set<string>();

    for (const input of heartbeat.sessions) {
      incomingSessionIds.add(input.id);
      const key = `${device.id}:${input.id}`;
      const existing = this.sessions.get(key);
      const updatedAt = toIso(now);

      if (existing) {
        existing.status = input.status;
        existing.tool = input.tool;
        existing.updatedAt = updatedAt;
        existing.lastActivityAt = input.lastActivityAt ?? updatedAt;
        if (input.repoPath) {
          existing.repoPath = input.repoPath;
        }
        if (input.branch) {
          existing.branch = input.branch;
        }
      } else {
        const session: RelaySession = {
          id: input.id,
          userId: device.userId,
          deviceId: device.id,
          tool: input.tool,
          status: input.status,
          updatedAt,
          lastActivityAt: input.lastActivityAt ?? updatedAt
        };
        if (input.repoPath) {
          session.repoPath = input.repoPath;
        }
        if (input.branch) {
          session.branch = input.branch;
        }
        this.sessions.set(key, session);
      }
    }

    for (const session of this.sessions.values()) {
      if (session.deviceId !== device.id) {
        continue;
      }
      if (incomingSessionIds.has(session.id)) {
        continue;
      }
      session.status = "disconnected";
      session.updatedAt = toIso(now);
    }

    return {
      deviceId,
      reconnectCount: device.reconnectCount,
      sessionsUpdated: heartbeat.sessions.length
    };
  }

  listSessionsForUser(userId: string): RelaySession[] {
    this.refreshConnectivity();
    return Array.from(this.sessions.values())
      .filter((session) => session.userId === userId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  listDevicesForUser(userId: string): RelayDevice[] {
    this.refreshConnectivity();
    return Array.from(this.devices.values())
      .filter((device) => device.userId === userId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private refreshConnectivity(): void {
    this.cleanupExpiredPairingCodes();
    const now = this.now();
    const cutoff = now.getTime() - this.config.heartbeatStaleSeconds * 1_000;

    for (const device of this.devices.values()) {
      if (device.status !== "connected") {
        continue;
      }
      const lastHeartbeat = device.lastHeartbeatAt ? new Date(device.lastHeartbeatAt).getTime() : 0;
      if (lastHeartbeat > cutoff) {
        continue;
      }

      device.status = "disconnected";
      device.updatedAt = toIso(now);

      for (const session of this.sessions.values()) {
        if (session.deviceId !== device.id) {
          continue;
        }
        session.status = "disconnected";
        session.updatedAt = toIso(now);
      }
    }
  }

  private cleanupExpiredPairingCodes(): void {
    const now = this.now().getTime();
    for (const [code, record] of this.pairingCodes.entries()) {
      if (new Date(record.expiresAt).getTime() <= now) {
        this.pairingCodes.delete(code);
      }
    }
  }
}
