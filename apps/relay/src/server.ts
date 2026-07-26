import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { loadRelayConfig } from "./config.js";
import { RelayStoreError } from "./errors.js";
import { parseBearerToken } from "./auth.js";
import { RelayStore } from "./store.js";
import type { DaemonHeartbeatInput, RelayConfig, SessionHeartbeatInput } from "./types.js";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
    throw new RelayStoreError("Bearer token required.", 401, "missing_device_token");
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
