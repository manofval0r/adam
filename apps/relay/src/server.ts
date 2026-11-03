import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { loadRelayConfig } from "./config.js";
import { RelayStoreError } from "./errors.js";
import { parseBearerToken } from "./auth.js";
import { RelayStore } from "./store.js";
import type {
  DaemonHeartbeatInput,
  PromptStatusUpdateInput,
  RelayConfig,
  RelayEvent,
  SessionHeartbeatInput
} from "./types.js";

export interface RelayServerOptions {
  config?: RelayConfig;
  store?: RelayStore;
}

interface PairingCodeRequest {
  userId: string;
  userName?: string;
}

interface PairingExchangeRequest {
  pairingCode: string;
  deviceName: string;
}

interface PromptSubmissionRequest {
  relaySessionId: string;
  text: string;
  clientPromptId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseOptionalLimit(value: unknown, fallback: number, maxLimit: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new RelayStoreError("limit must be a number.", 400, "invalid_limit");
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > maxLimit) {
    throw new RelayStoreError(`limit must be between 1 and ${maxLimit}.`, 400, "invalid_limit");
  }
  return parsed;
}

function parseOptionalSinceSequence(value: unknown): number {
  if (value === undefined) {
    return 0;
  }
  if (typeof value !== "string") {
    throw new RelayStoreError("sinceSequence must be a number.", 400, "invalid_since_sequence");
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new RelayStoreError("sinceSequence must be zero or greater.", 400, "invalid_since_sequence");
  }
  return parsed;
}

function parsePairingCodeRequest(body: unknown): PairingCodeRequest {
  if (!isRecord(body)) {
    throw new RelayStoreError("Expected JSON object body.", 400, "invalid_body");
  }

  const userId = body.userId;
  const userName = body.userName;
  if (typeof userId !== "string" || userId.trim().length === 0) {
    throw new RelayStoreError("userId is required.", 400, "invalid_user_id");
  }
  if (userName !== undefined && typeof userName !== "string") {
    throw new RelayStoreError("userName must be a string.", 400, "invalid_user_name");
  }

  const output: PairingCodeRequest = {
    userId: userId.trim()
  };

  if (typeof userName === "string" && userName.trim().length > 0) {
    output.userName = userName.trim();
  }

  return output;
}

function parsePairingExchangeRequest(body: unknown): PairingExchangeRequest {
  if (!isRecord(body)) {
    throw new RelayStoreError("Expected JSON object body.", 400, "invalid_body");
  }

  const pairingCode = body.pairingCode;
  const deviceName = body.deviceName;
  if (typeof pairingCode !== "string" || pairingCode.trim().length === 0) {
    throw new RelayStoreError("pairingCode is required.", 400, "invalid_pairing_code");
  }
  if (typeof deviceName !== "string" || deviceName.trim().length === 0) {
    throw new RelayStoreError("deviceName is required.", 400, "invalid_device_name");
  }

  return {
    pairingCode: pairingCode.trim().toUpperCase(),
    deviceName: deviceName.trim()
  };
}

function parsePromptSubmissionRequest(body: unknown): PromptSubmissionRequest {
  if (!isRecord(body)) {
    throw new RelayStoreError("Expected JSON object body.", 400, "invalid_body");
  }

  const relaySessionId = body.relaySessionId;
  const text = body.text;
  const clientPromptId = body.clientPromptId;
  if (typeof relaySessionId !== "string" || relaySessionId.trim().length === 0) {
    throw new RelayStoreError("relaySessionId is required.", 400, "invalid_session_id");
  }
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new RelayStoreError("text is required.", 400, "invalid_prompt_text");
  }
  if (typeof clientPromptId !== "string" || clientPromptId.trim().length === 0) {
    throw new RelayStoreError("clientPromptId is required.", 400, "invalid_client_prompt_id");
  }

  return {
    relaySessionId: relaySessionId.trim(),
    text: text.trim(),
    clientPromptId: clientPromptId.trim()
  };
}

function parsePromptStatusUpdateRequest(body: unknown): PromptStatusUpdateInput {
  if (!isRecord(body)) {
    throw new RelayStoreError("Expected JSON object body.", 400, "invalid_body");
  }

  const state = body.state;
  if (state !== "adapter_sent" && state !== "acknowledged" && state !== "failed") {
    throw new RelayStoreError("Invalid prompt state.", 400, "invalid_prompt_state");
  }

  const parsed: PromptStatusUpdateInput = { state };
  if (typeof body.errorCode === "string" && body.errorCode.trim().length > 0) {
    parsed.errorCode = body.errorCode.trim();
  }
  if (typeof body.errorMessage === "string" && body.errorMessage.trim().length > 0) {
    parsed.errorMessage = body.errorMessage.trim();
  }
  if (typeof body.assistantText === "string" && body.assistantText.trim().length > 0) {
    parsed.assistantText = body.assistantText.trim();
  }
  return parsed;
}

function parseHeartbeatSession(value: unknown): SessionHeartbeatInput {
  if (!isRecord(value)) {
    throw new RelayStoreError("Session item must be an object.", 400, "invalid_heartbeat_session");
  }

  const id = value.id;
  const status = value.status;
  const tool = value.tool;

  if (typeof id !== "string" || id.trim().length === 0) {
    throw new RelayStoreError("Session id is required.", 400, "invalid_heartbeat_session_id");
  }
  if (status !== "active" && status !== "idle" && status !== "failed" && status !== "disconnected") {
    throw new RelayStoreError("Session status is invalid.", 400, "invalid_heartbeat_session_status");
  }
  if (tool !== "codex_cli" && tool !== "unknown") {
    throw new RelayStoreError("Session tool is invalid.", 400, "invalid_heartbeat_session_tool");
  }

  const output: SessionHeartbeatInput = {
    id: id.trim(),
    status,
    tool
  };

  if (typeof value.repoPath === "string" && value.repoPath.trim().length > 0) {
    output.repoPath = value.repoPath.trim();
  }
  if (typeof value.branch === "string" && value.branch.trim().length > 0) {
    output.branch = value.branch.trim();
  }
  if (typeof value.lastActivityAt === "string" && value.lastActivityAt.trim().length > 0) {
    output.lastActivityAt = value.lastActivityAt.trim();
  }
  if (value.remotePromptConsent !== undefined) {
    if (typeof value.remotePromptConsent !== "boolean") {
      throw new RelayStoreError("remotePromptConsent must be a boolean.", 400, "invalid_remote_prompt_consent");
    }
    output.remotePromptConsent = value.remotePromptConsent;
  }

  return output;
}

function parseHeartbeatRequest(body: unknown): DaemonHeartbeatInput {
  if (!isRecord(body)) {
    throw new RelayStoreError("Expected JSON object body.", 400, "invalid_body");
  }

  const daemonVersion = body.daemonVersion;
  const sessions = body.sessions;
  if (typeof daemonVersion !== "string" || daemonVersion.trim().length === 0) {
    throw new RelayStoreError("daemonVersion is required.", 400, "invalid_daemon_version");
  }
  if (!Array.isArray(sessions)) {
    throw new RelayStoreError("sessions must be an array.", 400, "invalid_heartbeat_sessions");
  }

  return {
    daemonVersion: daemonVersion.trim(),
    sessions: sessions.map((item) => parseHeartbeatSession(item))
  };
}

function sendError(reply: FastifyReply, error: unknown): void {
  if (error instanceof RelayStoreError) {
    reply.code(error.statusCode).send({
      error: error.code,
      message: error.message
    });
    return;
  }

  const message = error instanceof Error ? error.message : "Unexpected relay error.";
  reply.code(500).send({
    error: "internal_error",
    message
  });
}

function authenticateDeviceRequest(request: FastifyRequest, store: RelayStore): { deviceId: string; userId: string } {
  const token = parseBearerToken(request.headers.authorization);
  if (!token) {
    throw new RelayStoreError("Device bearer token is required.", 401, "missing_device_token");
  }
  const device = store.authenticateDeviceToken(token);
  return {
    deviceId: device.id,
    userId: device.userId
  };
}

function normalizeRemoteAddress(address: string | undefined): string | null {
  if (!address) {
    return null;
  }
  if (address === "::1") {
    return "127.0.0.1";
  }
  if (address.startsWith("::ffff:")) {
    return address.slice("::ffff:".length);
  }
  return address;
}

function isTrustedProxySource(request: FastifyRequest, trustedProxyIps: string[]): boolean {
  const remoteAddress = normalizeRemoteAddress(request.raw.socket.remoteAddress);
  return remoteAddress !== null && trustedProxyIps.includes(remoteAddress);
}

/**
 * Shapes a stored relay event for the wire.
 *
 * The shared event envelope has no `userId` field, and every event in a
 * response belongs to the user already named at the top level of that
 * response, so the relay-local `userId` is dropped here.
 */
function toEnvelopeEvent(event: RelayEvent): Omit<RelayEvent, "userId"> {
  const { userId: _eventUserId, ...envelope } = event;
  return envelope;
}

export function createRelayServer(options?: RelayServerOptions): FastifyInstance {
  const config = options?.config ?? loadRelayConfig();
  if (
    config.environment === "production" &&
    !options?.store &&
    !config.allowInMemoryStoreInProduction
  ) {
    throw new Error(
      "In-memory relay store is disabled in production. Configure a persistent store or set RELAY_ALLOW_IN_MEMORY_STORE_PRODUCTION=true for temporary single-instance usage."
    );
  }
  if (
    config.environment === "production" &&
    config.trustProxy &&
    config.trustedProxyIps.length === 0
  ) {
    throw new Error(
      "RELAY_TRUSTED_PROXY_IPS must be set when RELAY_TRUST_PROXY=true in production."
    );
  }

  const store = options?.store ?? new RelayStore(config);
  const app = Fastify({
    logger: false,
    trustProxy: config.trustProxy
  });

  app.addHook("onRequest", async (request, reply) => {
    if (!config.enforceTlsInProduction || config.environment !== "production") {
      return;
    }

    const isTlsSocket = "encrypted" in request.raw.socket && Boolean((request.raw.socket as { encrypted?: boolean }).encrypted);
    if (isTlsSocket) {
      return;
    }
    if (
      config.trustProxy &&
      request.protocol === "https" &&
      isTrustedProxySource(request, config.trustedProxyIps)
    ) {
      return;
    }

    reply.code(426).send({
      error: "insecure_transport",
      message: "HTTPS is required for relay traffic in production."
    });
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "adam-relay",
    generatedAt: new Date().toISOString()
  }));

  app.get("/v1/transport/assumptions", async () => ({
    tlsRequiredInProduction: config.enforceTlsInProduction,
    acceptedProductionProtocols: ["https", "wss"],
    trustProxy: config.trustProxy,
    trustedProxyIps: config.trustedProxyIps,
    localDevelopment: {
      allowed: true,
      note: "Plain HTTP is allowed for local development only."
    },
    reconnect: {
      heartbeatStaleSeconds: config.heartbeatStaleSeconds,
      behavior: "Devices are marked disconnected when heartbeats become stale and return to connected on next valid heartbeat."
    }
  }));

  app.post("/v1/pairing/codes", async (request, reply) => {
    try {
      if (config.bootstrapApiKey.length === 0) {
        throw new RelayStoreError("Pairing is not configured.", 503, "pairing_not_configured");
      }

      const bootstrapHeaderRaw = request.headers["x-relay-bootstrap-key"];
      const bootstrapHeader = Array.isArray(bootstrapHeaderRaw) ? bootstrapHeaderRaw[0] : bootstrapHeaderRaw;
      if (!bootstrapHeader || bootstrapHeader !== config.bootstrapApiKey) {
        throw new RelayStoreError("Bootstrap API key is required.", 401, "invalid_bootstrap_key");
      }

      const payload = parsePairingCodeRequest(request.body);
      const record = store.issuePairingCode(payload.userId, payload.userName);
      reply.code(201).send({
        pairingCode: record.code,
        userId: record.userId,
        expiresAt: record.expiresAt
      });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/v1/pairing/exchange", async (request, reply) => {
    try {
      const payload = parsePairingExchangeRequest(request.body);
      const { device, deviceToken } = store.exchangePairingCode(payload.pairingCode, payload.deviceName);

      reply.code(201).send({
        deviceId: device.id,
        deviceName: device.name,
        userId: device.userId,
        deviceToken,
        tokenExpiresAt: device.tokenExpiresAt
      });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/v1/daemon/heartbeat", async (request, reply) => {
    try {
      const principal = authenticateDeviceRequest(request, store);
      const heartbeat = parseHeartbeatRequest(request.body);
      const result = store.recordHeartbeat(principal.deviceId, heartbeat);

      reply.send({
        status: "accepted",
        deviceId: result.deviceId,
        reconnectCount: result.reconnectCount,
        sessionsUpdated: result.sessionsUpdated
      });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get("/v1/daemon/prompts", async (request, reply) => {
    try {
      const principal = authenticateDeviceRequest(request, store);
      const query = isRecord(request.query) ? request.query : {};
      const limit = parseOptionalLimit(query.limit, 20, 100);
      const prompts = store.dequeuePromptsForDevice(principal.deviceId, limit);
      reply.send({
        prompts
      });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/v1/daemon/prompts/:promptId/status", async (request, reply) => {
    try {
      const principal = authenticateDeviceRequest(request, store);
      const params = request.params;
      if (!isRecord(params)) {
        throw new RelayStoreError("Invalid prompt params.", 400, "invalid_prompt_params");
      }
      const promptId = params.promptId;
      if (typeof promptId !== "string" || promptId.trim().length === 0) {
        throw new RelayStoreError("promptId is required.", 400, "invalid_prompt_id");
      }

      const statusUpdate = parsePromptStatusUpdateRequest(request.body);
      const prompt = store.updatePromptState(principal.deviceId, promptId.trim(), statusUpdate);
      reply.send({
        promptId: prompt.id,
        state: prompt.state,
        updatedAt: prompt.updatedAt
      });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/v1/prompts", async (request, reply) => {
    try {
      const principal = authenticateDeviceRequest(request, store);
      const payload = parsePromptSubmissionRequest(request.body);
      const prompt = store.submitPrompt(principal.userId, payload.relaySessionId, payload.text, payload.clientPromptId);
      reply.code(202).send({
        promptId: prompt.id,
        state: prompt.state,
        relaySessionId: payload.relaySessionId,
        sessionId: prompt.sessionId,
        createdAt: prompt.createdAt,
        updatedAt: prompt.updatedAt
      });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get("/v1/prompts", async (request, reply) => {
    try {
      const principal = authenticateDeviceRequest(request, store);
      const query = isRecord(request.query) ? request.query : {};
      const sessionIdRaw = query.sessionId;
      const sessionId = typeof sessionIdRaw === "string" && sessionIdRaw.trim().length > 0
        ? sessionIdRaw.trim()
        : undefined;
      const prompts = store.listPromptsForUser(principal.userId, sessionId).map((prompt) => ({
        id: prompt.id,
        sessionId: prompt.sessionId,
        state: prompt.state,
        createdAt: prompt.createdAt,
        updatedAt: prompt.updatedAt,
        errorCode: prompt.errorCode,
        errorMessage: prompt.errorMessage
      }));
      reply.send({
        userId: principal.userId,
        prompts
      });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get("/v1/events", async (request, reply) => {
    try {
      const principal = authenticateDeviceRequest(request, store);
      const query = isRecord(request.query) ? request.query : {};
      const sinceSequence = parseOptionalSinceSequence(query.sinceSequence);
      const limit = parseOptionalLimit(query.limit, 50, 200);
      const events = store.listEventsForUser(principal.userId, sinceSequence, limit).map(toEnvelopeEvent);
      const lastEvent = events.length > 0 ? events[events.length - 1] : null;
      const lastSequence = lastEvent ? lastEvent.sequence : sinceSequence;
      reply.send({
        userId: principal.userId,
        sinceSequence,
        lastSequence,
        events
      });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get("/v1/sessions", async (request, reply) => {
    try {
      const principal = authenticateDeviceRequest(request, store);
      const sessions = store.listSessionsForUser(principal.userId);
      reply.send({
        userId: principal.userId,
        sessions
      });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get("/v1/devices", async (request, reply) => {
    try {
      const principal = authenticateDeviceRequest(request, store);
      const devices = store.listDevicesForUser(principal.userId);
      reply.send({
        userId: principal.userId,
        devices: devices.map((device) => ({
          id: device.id,
          name: device.name,
          status: device.status,
          reconnectCount: device.reconnectCount,
          lastHeartbeatAt: device.lastHeartbeatAt,
          createdAt: device.createdAt,
          updatedAt: device.updatedAt
        }))
      });
    } catch (error) {
      sendError(reply, error);
    }
  });

  return app;
}
