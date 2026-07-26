import Fastify from "fastify";
import { renderClientScript, renderIndexHtml } from "./templates.js";

interface WebConfig {
  host: string;
  port: number;
  relayBaseUrl: string;
  relayTimeoutMs: number;
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function normalizeBaseUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function loadConfig(): WebConfig {
  const relayBaseUrl = process.env.ADAM_RELAY_BASE_URL;
  if (!relayBaseUrl || relayBaseUrl.trim().length === 0) {
    throw new Error("ADAM_RELAY_BASE_URL is required to start the web client.");
  }

  return {
    host: process.env.ADAM_WEB_HOST ?? "127.0.0.1",
    port: parseInteger(process.env.ADAM_WEB_PORT, 4173),
    relayBaseUrl: normalizeBaseUrl(relayBaseUrl.trim()),
    relayTimeoutMs: parseInteger(process.env.ADAM_WEB_RELAY_TIMEOUT_MS, 12_000)
  };
}

async function requestRelay(
  config: WebConfig,
  token: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<{ status: number; payload: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.relayTimeoutMs);
  try {
    const init: RequestInit = {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      signal: controller.signal
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const response = await fetch(`${config.relayBaseUrl}${path}`, init);

    let payload: unknown = {};
    try {
      payload = await response.json();
    } catch {
      payload = {
        error: "invalid_json",
        message: "Relay returned non-JSON response."
      };
    }

    return {
      status: response.status,
      payload
    };
  } finally {
    clearTimeout(timer);
  }
}

async function start(): Promise<void> {
  const config = loadConfig();
  const app = Fastify({ logger: false });

  app.get("/", async (_request, reply) => {
    reply.type("text/html; charset=utf-8").send(renderIndexHtml());
  });

  app.get("/app.js", async (_request, reply) => {
    reply.type("application/javascript; charset=utf-8").send(renderClientScript());
  });

  app.get("/api/bootstrap", async () => ({
    relayBaseUrl: config.relayBaseUrl
  }));

  app.get("/api/sessions", async (request, reply) => {
    const header = request.headers["x-adam-device-token"];
    const token = typeof header === "string" ? header.trim() : "";
    if (token.length === 0) {
      reply.code(400).send({
        error: "missing_token",
        message: "Device token is required."
      });
      return;
    }

    const result = await requestRelay(config, token, "GET", "/v1/sessions");
    reply.code(result.status).send(result.payload);
  });

  app.get("/api/events", async (request, reply) => {
    const query = request.query as { sinceSequence?: string; limit?: string };
    const header = request.headers["x-adam-device-token"];
    const token = typeof header === "string" ? header.trim() : "";
    if (token.length === 0) {
      reply.code(400).send({
        error: "missing_token",
        message: "Device token is required."
      });
      return;
    }

    const sinceSequence = typeof query.sinceSequence === "string" ? query.sinceSequence : "0";
    const limit = typeof query.limit === "string" ? query.limit : "100";
    const result = await requestRelay(
      config,
      token,
      "GET",
      `/v1/events?sinceSequence=${encodeURIComponent(sinceSequence)}&limit=${encodeURIComponent(limit)}`
    );
    reply.code(result.status).send(result.payload);
  });

  app.post("/api/prompts", async (request, reply) => {
    const body = request.body as { relaySessionId?: string; text?: string; clientPromptId?: string } | undefined;
    const header = request.headers["x-adam-device-token"];
    const token = typeof header === "string" ? header.trim() : "";
    const relaySessionId = typeof body?.relaySessionId === "string" ? body.relaySessionId.trim() : "";
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const clientPromptId = typeof body?.clientPromptId === "string" ? body.clientPromptId.trim() : "";
    if (token.length === 0) {
      reply.code(400).send({
        error: "missing_token",
        message: "Device token is required."
      });
      return;
    }
    if (relaySessionId.length === 0 || text.length === 0 || clientPromptId.length === 0) {
      reply.code(400).send({
        error: "invalid_prompt",
        message: "relaySessionId, text, and clientPromptId are required."
      });
      return;
    }

    const result = await requestRelay(config, token, "POST", "/v1/prompts", {
      relaySessionId,
      text,
      clientPromptId
    });
    reply.code(result.status).send(result.payload);
  });

  await app.listen({
    host: config.host,
    port: config.port
  });
  console.log(`adam-web listening on http://${config.host}:${config.port}`);
}

start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`adam-web error: ${message}`);
  process.exitCode = 1;
});
