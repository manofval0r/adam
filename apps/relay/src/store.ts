import { randomBytes, randomUUID } from "node:crypto";
import { SCHEMA_VERSION } from "@adam/contracts";
import type { EventActor, EventSource } from "@adam/contracts";
import { hashToken } from "./auth.js";
import { RelayStoreError } from "./errors.js";
import type {
  DaemonHeartbeatInput,
  PairingCodeRecord,
  PromptStatusUpdateInput,
  QueuedPrompt,
  RelayActivityEventPayload,
  RelayConfig,
  RelayDevice,
  RelayErrorEventPayload,
  RelayEvent,
  RelayMessageEventPayload,
  RelayPrompt,
  RelayPromptDeliveryPayload,
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

/**
 * The relay's own identity in the shared event envelope.
 *
 * The relay is one deployment-level actor, so every event it emits carries
 * this same source and actor instead of a freshly minted identity per event.
 */
const RELAY_EVENT_SOURCE: EventSource = {
  kind: "cloud_relay",
  id: "adam-relay",
  name: "Adam Relay",
  version: "0.1.0"
};

const RELAY_EVENT_ACTOR: EventActor = {
  kind: "system",
  id: "adam-relay",
  displayName: "Adam Relay"
};

export class RelayStore {
  private readonly users = new Map<string, RelayUser>();
  private readonly devices = new Map<string, RelayDevice>();
  private readonly sessions = new Map<string, RelaySession>();
  private readonly pairingCodes = new Map<string, PairingCodeRecord>();
  private readonly deviceTokenHashes = new Map<string, string>();
  private readonly prompts = new Map<string, RelayPrompt>();
  private readonly promptIdempotency = new Map<string, string>();
  private readonly eventsByUser = new Map<string, RelayEvent[]>();
  private readonly eventSequenceByUser = new Map<string, number>();
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
      this.appendActivityEvent(device.userId, {
        title: "Daemon reconnected",
        status: "completed",
        category: "syncing",
        body: `Device ${device.name} reconnected and resumed heartbeat updates.`
      });
    }

    const incomingSessionIds = new Set<string>();

    for (const input of heartbeat.sessions) {
      incomingSessionIds.add(input.id);
      const key = `${device.id}:${input.id}`;
      const existing = this.sessions.get(key);
      const updatedAt = toIso(now);

      if (existing) {
        const previousConsent = existing.remotePromptConsent;
        existing.remotePromptConsent = input.remotePromptConsent === true;
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
        if (previousConsent && !existing.remotePromptConsent) {
          this.cancelQueuedPromptsForSession(
            existing.userId,
            existing.id,
            "remote_prompt_consent_revoked",
            "Remote prompt consent was revoked before daemon delivery."
          );
        }
      } else {
        const session: RelaySession = {
          relaySessionId: key,
          id: input.id,
          userId: device.userId,
          deviceId: device.id,
          tool: input.tool,
          remotePromptConsent: input.remotePromptConsent === true,
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
        const matchedInput = heartbeat.sessions.find((candidate) => candidate.id === session.id);
        if (matchedInput) {
          session.remotePromptConsent = matchedInput.remotePromptConsent === true;
        }
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

  submitPrompt(userId: string, relaySessionId: string, text: string, clientPromptId: string): RelayPrompt {
    this.refreshConnectivity();
    const session = this.findUserSession(userId, relaySessionId);
    if (!session.remotePromptConsent) {
      throw new RelayStoreError(
        "Remote prompting is not enabled for this session.",
        403,
        "remote_prompt_consent_required"
      );
    }
    if (session.status !== "active" && session.status !== "idle") {
      throw new RelayStoreError("Session is not available for remote prompting.", 409, "session_unavailable");
    }

    const idempotencyKey = `${userId}:${relaySessionId}:${clientPromptId}`;
    const existingPromptId = this.promptIdempotency.get(idempotencyKey);
    if (existingPromptId) {
      const existingPrompt = this.prompts.get(existingPromptId);
      if (!existingPrompt) {
        throw new RelayStoreError("Prompt idempotency state is invalid.", 500, "prompt_idempotency_corrupt");
      }
      return existingPrompt;
    }

    const now = this.now();
    const promptId = `prompt_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const prompt: RelayPrompt = {
      id: promptId,
      userId,
      deviceId: session.deviceId,
      sessionId: session.id,
      text,
      state: "relay_received",
      deliveryAttemptCount: 0,
      createdAt: toIso(now),
      updatedAt: toIso(now)
    };
    prompt.clientPromptId = clientPromptId;

    this.prompts.set(prompt.id, prompt);
    this.promptIdempotency.set(idempotencyKey, prompt.id);
    this.appendMessageEvent(userId, session.id, {
      role: "user",
      text,
      format: "plain_text",
      promptId: prompt.id
    }, prompt.id);
    this.appendPromptDeliveryEvent(userId, session.id, {
      promptId: prompt.id,
      state: "relay_received"
    }, prompt.id);
    this.appendActivityEvent(userId, {
      title: "Prompt queued",
      body: "Prompt accepted by relay and queued for daemon pickup.",
      status: "started",
      category: "syncing",
      promptId: prompt.id
    }, session.id, prompt.id);
    return prompt;
  }

  dequeuePromptsForDevice(deviceId: string, limit: number): QueuedPrompt[] {
    this.refreshConnectivity();
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new RelayStoreError("Device not found.", 404, "device_not_found");
    }

    const pending = Array.from(this.prompts.values())
      .filter((prompt) => prompt.deviceId === deviceId && prompt.state === "relay_received")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const now = this.now();
    const dequeued: QueuedPrompt[] = [];
    for (const prompt of pending) {
      if (dequeued.length >= limit) {
        break;
      }

      const session = this.findSessionByDeviceAndSessionId(deviceId, prompt.sessionId);
      if (!session || !session.remotePromptConsent) {
        this.failPromptBeforeDelivery(
          prompt,
          "remote_prompt_consent_revoked",
          "Remote prompting is no longer enabled for this session."
        );
        continue;
      }
      if (session.status !== "active" && session.status !== "idle") {
        this.failPromptBeforeDelivery(
          prompt,
          "session_unavailable",
          "Session is no longer available for prompt delivery."
        );
        continue;
      }

      prompt.state = "daemon_received";
      prompt.dequeuedAt = toIso(now);
      prompt.leaseExpiresAt = toIso(plusSeconds(now, this.config.promptLeaseSeconds));
      prompt.deliveryAttemptCount += 1;
      prompt.updatedAt = toIso(now);
      this.appendPromptDeliveryEvent(prompt.userId, prompt.sessionId, {
        promptId: prompt.id,
        state: "daemon_received"
      }, prompt.id);
      this.appendActivityEvent(prompt.userId, {
        title: "Daemon picked up prompt",
        status: "in_progress",
        category: "syncing",
        body: `Prompt delivery started from device ${device.name}.`,
        promptId: prompt.id
      }, prompt.sessionId, prompt.id);
      dequeued.push({
        promptId: prompt.id,
        sessionId: prompt.sessionId,
        text: prompt.text,
        createdAt: prompt.createdAt,
        leaseExpiresAt: prompt.leaseExpiresAt,
        correlationId: prompt.id
      });
    }

    return dequeued;
  }

  updatePromptState(deviceId: string, promptId: string, update: PromptStatusUpdateInput): RelayPrompt {
    this.refreshConnectivity();
    const prompt = this.prompts.get(promptId);
    if (!prompt) {
      throw new RelayStoreError("Prompt not found.", 404, "prompt_not_found");
    }
    if (prompt.deviceId !== deviceId) {
      throw new RelayStoreError("Prompt does not belong to this device.", 403, "prompt_forbidden");
    }
    this.ensurePromptTransitionAllowed(prompt.state, update.state);

    const nowIso = toIso(this.now());
    prompt.state = update.state;
    prompt.updatedAt = nowIso;
    if (update.errorCode) {
      prompt.errorCode = update.errorCode;
    }
    if (update.errorMessage) {
      prompt.errorMessage = update.errorMessage;
    }
    if (update.assistantText) {
      prompt.assistantText = update.assistantText;
    }
    if (update.state === "adapter_sent") {
      prompt.leaseExpiresAt = toIso(plusSeconds(this.now(), this.config.promptLeaseSeconds));
    }
    if (update.state === "acknowledged" || update.state === "failed") {
      prompt.completedAt = nowIso;
      delete prompt.leaseExpiresAt;
    }

    const deliveryPayload: RelayPromptDeliveryPayload = {
      promptId: prompt.id,
      state: prompt.state
    };
    if (prompt.errorCode) {
      deliveryPayload.errorCode = prompt.errorCode;
    }
    if (prompt.errorMessage) {
      deliveryPayload.errorMessage = prompt.errorMessage;
    }

    this.appendPromptDeliveryEvent(prompt.userId, prompt.sessionId, deliveryPayload, prompt.id);

    if (update.state === "acknowledged") {
      this.appendActivityEvent(prompt.userId, {
        title: "Prompt completed",
        status: "completed",
        category: "syncing",
        body: "Daemon completed remote prompt delivery.",
        promptId: prompt.id
      }, prompt.sessionId, prompt.id);
      if (prompt.assistantText) {
        this.appendMessageEvent(prompt.userId, prompt.sessionId, {
          role: "assistant",
          text: prompt.assistantText,
          format: "plain_text",
          promptId: prompt.id
        }, prompt.id);
      }
    } else if (update.state === "failed") {
      this.appendActivityEvent(prompt.userId, {
        title: "Prompt failed",
        status: "failed",
        category: "syncing",
        body: prompt.errorMessage ?? "Daemon could not complete prompt delivery.",
        promptId: prompt.id
      }, prompt.sessionId, prompt.id);
      this.appendErrorEvent(prompt.userId, prompt.sessionId, {
        code: prompt.errorCode ?? "prompt_delivery_failed",
        message: prompt.errorMessage ?? "Prompt delivery failed.",
        severity: "error",
        retryable: true,
        promptId: prompt.id
      }, prompt.id);
    }

    return prompt;
  }

  listEventsForUser(userId: string, sinceSequence: number, limit: number): RelayEvent[] {
    this.refreshConnectivity();
    const events = this.eventsByUser.get(userId) ?? [];
    return events
      .filter((event) => event.sequence > sinceSequence)
      .sort((left, right) => left.sequence - right.sequence)
      .slice(0, limit);
  }

  listPromptsForUser(userId: string, sessionId?: string): RelayPrompt[] {
    this.refreshConnectivity();
    return Array.from(this.prompts.values())
      .filter((prompt) => prompt.userId === userId && (!sessionId || prompt.sessionId === sessionId))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
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

  private ensurePromptTransitionAllowed(current: RelayPrompt["state"], next: PromptStatusUpdateInput["state"]): void {
    const allowed: Record<RelayPrompt["state"], PromptStatusUpdateInput["state"][]> = {
      queued: [],
      relay_received: ["adapter_sent", "acknowledged", "failed"],
      daemon_received: ["adapter_sent", "acknowledged", "failed"],
      adapter_sent: ["acknowledged", "failed"],
      acknowledged: [],
      failed: []
    };
    if (!allowed[current].includes(next)) {
      throw new RelayStoreError(
        `Invalid prompt state transition from ${current} to ${next}.`,
        409,
        "invalid_prompt_state_transition"
      );
    }
  }

  private findUserSession(userId: string, sessionId: string): RelaySession {
    const session = Array.from(this.sessions.values()).find(
      (candidate) => candidate.userId === userId && candidate.relaySessionId === sessionId
    );
    if (!session) {
      throw new RelayStoreError("Session not found for current user.", 404, "session_not_found");
    }
    return session;
  }

  private findSessionByDeviceAndSessionId(deviceId: string, sessionId: string): RelaySession | null {
    const key = `${deviceId}:${sessionId}`;
    return this.sessions.get(key) ?? null;
  }

  private failPromptBeforeDelivery(prompt: RelayPrompt, errorCode: string, errorMessage: string): void {
    prompt.state = "failed";
    prompt.errorCode = errorCode;
    prompt.errorMessage = errorMessage;
    const nowIso = toIso(this.now());
    prompt.updatedAt = nowIso;
    prompt.completedAt = nowIso;
    delete prompt.leaseExpiresAt;
    this.appendPromptDeliveryEvent(prompt.userId, prompt.sessionId, {
      promptId: prompt.id,
      state: "failed",
      errorCode,
      errorMessage
    }, prompt.id);
    this.appendActivityEvent(prompt.userId, {
      title: "Prompt failed",
      status: "failed",
      category: "syncing",
      body: errorMessage,
      promptId: prompt.id
    }, prompt.sessionId, prompt.id);
    this.appendErrorEvent(prompt.userId, prompt.sessionId, {
      code: errorCode,
      message: errorMessage,
      severity: "error",
      retryable: true,
      promptId: prompt.id
    }, prompt.id);
  }

  private cancelQueuedPromptsForSession(
    userId: string,
    sessionId: string,
    errorCode: string,
    errorMessage: string
  ): void {
    for (const prompt of this.prompts.values()) {
      if (prompt.userId !== userId || prompt.sessionId !== sessionId || prompt.state !== "relay_received") {
        continue;
      }
      this.failPromptBeforeDelivery(prompt, errorCode, errorMessage);
    }
  }

  private appendMessageEvent(
    userId: string,
    sessionId: string,
    payload: RelayMessageEventPayload,
    correlationId?: string
  ): void {
    this.appendEvent(userId, sessionId, "message", payload, correlationId);
  }

  private appendActivityEvent(
    userId: string,
    payload: RelayActivityEventPayload,
    sessionId: string = "relay",
    correlationId?: string
  ): void {
    this.appendEvent(userId, sessionId, "activity", payload, correlationId);
  }

  private appendPromptDeliveryEvent(
    userId: string,
    sessionId: string,
    payload: RelayPromptDeliveryPayload,
    correlationId?: string
  ): void {
    this.appendEvent(userId, sessionId, "prompt_delivery", payload, correlationId);
  }

  private appendErrorEvent(
    userId: string,
    sessionId: string,
    payload: RelayErrorEventPayload,
    correlationId?: string
  ): void {
    this.appendEvent(userId, sessionId, "error", payload, correlationId);
  }

  private appendEvent(
    userId: string,
    sessionId: string,
    type: RelayEvent["type"],
    payload: RelayEvent["payload"],
    correlationId?: string
  ): void {
    const sequence = (this.eventSequenceByUser.get(userId) ?? 0) + 1;
    this.eventSequenceByUser.set(userId, sequence);
    const event: RelayEvent = {
      id: randomUUID(),
      userId,
      sessionId,
      type,
      sequence,
      createdAt: toIso(this.now()),
      schemaVersion: SCHEMA_VERSION,
      source: RELAY_EVENT_SOURCE,
      actor: RELAY_EVENT_ACTOR,
      visibility: "user_visible",
      retention: {
        class: "standard"
      },
      payload
    };
    if (correlationId) {
      event.correlationId = correlationId;
    }

    const current = this.eventsByUser.get(userId) ?? [];
    current.push(event);
    this.eventsByUser.set(userId, current);
  }

  private refreshConnectivity(): void {
    this.cleanupExpiredPairingCodes();
    this.recoverExpiredPromptLeases();
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
      this.appendActivityEvent(device.userId, {
        title: "Daemon disconnected",
        status: "blocked",
        category: "waiting",
        body: `Device ${device.name} heartbeat became stale.`,
      });

      for (const session of this.sessions.values()) {
        if (session.deviceId !== device.id) {
          continue;
        }
        session.status = "disconnected";
        session.updatedAt = toIso(now);
      }
    }
  }

  private recoverExpiredPromptLeases(): void {
    const now = this.now().getTime();
    for (const prompt of this.prompts.values()) {
      if ((prompt.state !== "daemon_received" && prompt.state !== "adapter_sent") || !prompt.leaseExpiresAt) {
        continue;
      }
      const leaseTime = new Date(prompt.leaseExpiresAt).getTime();
      if (leaseTime > now) {
        continue;
      }

      prompt.state = "relay_received";
      prompt.updatedAt = toIso(this.now());
      delete prompt.leaseExpiresAt;
      this.appendActivityEvent(
        prompt.userId,
        {
          title: "Prompt re-queued",
          status: "blocked",
          category: "waiting",
          body: "Daemon did not complete delivery before lease expiry. Prompt was re-queued.",
          promptId: prompt.id
        },
        prompt.sessionId,
        prompt.id
      );
      this.appendPromptDeliveryEvent(
        prompt.userId,
        prompt.sessionId,
        {
          promptId: prompt.id,
          state: "relay_received"
        },
        prompt.id
      );
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
