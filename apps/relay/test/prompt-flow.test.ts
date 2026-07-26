import { describe, expect, it } from "vitest";
import { createRelayServer } from "../src/server.js";
import { RelayStore } from "../src/store.js";
import type { RelayConfig } from "../src/types.js";

function relayConfig(): RelayConfig {
  return {
    environment: "test",
    host: "127.0.0.1",
    port: 8787,
    pairingCodeTtlSeconds: 180,
    heartbeatStaleSeconds: 30,
    promptLeaseSeconds: 60,
    deviceTokenTtlDays: 30,
    enforceTlsInProduction: false,
    trustProxy: false,
    trustedProxyIps: [],
    allowInMemoryStoreInProduction: false,
    bootstrapApiKey: "test-bootstrap"
  };
}

async function pairDeviceAndStartSession(
  app: ReturnType<typeof createRelayServer>,
  userId: string,
  sessionId: string
): Promise<{ deviceToken: string; relaySessionId: string }> {
  const issue = await app.inject({
    method: "POST",
    url: "/v1/pairing/codes",
    headers: { "x-relay-bootstrap-key": "test-bootstrap" },
    payload: { userId }
  });
  const pairingCode = (issue.json() as { pairingCode: string }).pairingCode;
  const exchange = await app.inject({
    method: "POST",
    url: "/v1/pairing/exchange",
    payload: { pairingCode, deviceName: `${userId}-device` }
  });
  const deviceToken = (exchange.json() as { deviceToken: string }).deviceToken;

  await app.inject({
    method: "POST",
    url: "/v1/daemon/heartbeat",
    headers: { authorization: `Bearer ${deviceToken}` },
    payload: {
      daemonVersion: "0.2.0",
      sessions: [
        {
          id: sessionId,
          tool: "codex_cli",
          status: "active",
          remotePromptConsent: true
        }
      ]
    }
  });

  const sessions = await app.inject({
    method: "GET",
    url: "/v1/sessions",
    headers: { authorization: `Bearer ${deviceToken}` }
  });
  const sessionList = sessions.json() as {
    sessions: Array<{ id: string; relaySessionId: string }>;
  };
  const found = sessionList.sessions.find((session) => session.id === sessionId);
  if (!found) {
    throw new Error("Expected relay session after heartbeat.");
  }

  return {
    deviceToken,
    relaySessionId: found.relaySessionId
  };
}

describe("relay prompt flow", () => {
  it("submits prompt, delivers to daemon, and records acknowledged state in feed", async () => {
    const app = createRelayServer({ config: relayConfig() });
    try {
      const paired = await pairDeviceAndStartSession(app, "user-prompt-a", "session-a");

      const submit = await app.inject({
        method: "POST",
        url: "/v1/prompts",
        headers: { authorization: `Bearer ${paired.deviceToken}` },
        payload: {
          relaySessionId: paired.relaySessionId,
          text: "Please summarize current failing tests.",
          clientPromptId: "client-prompt-1"
        }
      });
      expect(submit.statusCode).toBe(202);
      const submitted = submit.json() as { promptId: string; state: string };
      expect(submitted.state).toBe("relay_received");

      const dequeue = await app.inject({
        method: "GET",
        url: "/v1/daemon/prompts?limit=10",
        headers: { authorization: `Bearer ${paired.deviceToken}` }
      });
      expect(dequeue.statusCode).toBe(200);
      const dequeued = dequeue.json() as { prompts: Array<{ promptId: string; sessionId: string }> };
      expect(dequeued.prompts).toHaveLength(1);
      expect(dequeued.prompts[0].promptId).toBe(submitted.promptId);
      expect(dequeued.prompts[0].sessionId).toBe("session-a");

      const adapterSent = await app.inject({
        method: "POST",
        url: `/v1/daemon/prompts/${submitted.promptId}/status`,
        headers: { authorization: `Bearer ${paired.deviceToken}` },
        payload: { state: "adapter_sent" }
      });
      expect(adapterSent.statusCode).toBe(200);

      const acknowledged = await app.inject({
        method: "POST",
        url: `/v1/daemon/prompts/${submitted.promptId}/status`,
        headers: { authorization: `Bearer ${paired.deviceToken}` },
        payload: {
          state: "acknowledged",
          assistantText: "The failing suite is api-auth with two failing cases."
        }
      });
      expect(acknowledged.statusCode).toBe(200);

      const promptList = await app.inject({
        method: "GET",
        url: "/v1/prompts",
        headers: { authorization: `Bearer ${paired.deviceToken}` }
      });
      const promptListJson = promptList.json() as {
        prompts: Array<{ id: string; state: string }>;
      };
      expect(promptListJson.prompts[0].id).toBe(submitted.promptId);
      expect(promptListJson.prompts[0].state).toBe("acknowledged");

      const events = await app.inject({
        method: "GET",
        url: "/v1/events?sinceSequence=0&limit=100",
        headers: { authorization: `Bearer ${paired.deviceToken}` }
      });
      const eventsJson = events.json() as {
        events: Array<{ type: string; payload: { state?: string; promptId?: string; role?: string } }>;
      };
      const deliveryStates = eventsJson.events
        .filter((event) => event.type === "prompt_delivery" && event.payload.promptId === submitted.promptId)
        .map((event) => event.payload.state);
      expect(deliveryStates).toEqual([
        "relay_received",
        "daemon_received",
        "adapter_sent",
        "acknowledged"
      ]);
      const assistantMessage = eventsJson.events.find(
        (event) => event.type === "message" && event.payload.role === "assistant"
      );
      expect(assistantMessage).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it("returns session_unavailable when session is disconnected", async () => {
    let now = new Date("2026-07-26T10:00:00.000Z");
    const config = relayConfig();
    const store = new RelayStore(config, { now: () => now });
    const app = createRelayServer({ config, store });
    try {
      const paired = await pairDeviceAndStartSession(app, "user-prompt-b", "session-b");
      now = new Date(now.getTime() + 31_000);

      const response = await app.inject({
        method: "POST",
        url: "/v1/prompts",
        headers: { authorization: `Bearer ${paired.deviceToken}` },
        payload: {
          relaySessionId: paired.relaySessionId,
          text: "Continue from latest task.",
          clientPromptId: "client-prompt-2"
        }
      });
      expect(response.statusCode).toBe(409);
      const body = response.json() as { error: string };
      expect(body.error).toBe("session_unavailable");
    } finally {
      await app.close();
    }
  });

  it("records failed prompt state with explicit error details", async () => {
    const app = createRelayServer({ config: relayConfig() });
    try {
      const paired = await pairDeviceAndStartSession(app, "user-prompt-c", "session-c");
      const submit = await app.inject({
        method: "POST",
        url: "/v1/prompts",
        headers: { authorization: `Bearer ${paired.deviceToken}` },
        payload: {
          relaySessionId: paired.relaySessionId,
          text: "Run migrations and report status.",
          clientPromptId: "client-prompt-3"
        }
      });
      const promptId = (submit.json() as { promptId: string }).promptId;

      await app.inject({
        method: "GET",
        url: "/v1/daemon/prompts?limit=5",
        headers: { authorization: `Bearer ${paired.deviceToken}` }
      });

      const failed = await app.inject({
        method: "POST",
        url: `/v1/daemon/prompts/${promptId}/status`,
        headers: { authorization: `Bearer ${paired.deviceToken}` },
        payload: {
          state: "failed",
          errorCode: "codex_unavailable",
          errorMessage: "Codex CLI not available on daemon host."
        }
      });
      expect(failed.statusCode).toBe(200);

      const prompts = await app.inject({
        method: "GET",
        url: "/v1/prompts",
        headers: { authorization: `Bearer ${paired.deviceToken}` }
      });
      const promptsJson = prompts.json() as {
        prompts: Array<{ id: string; state: string; errorCode?: string }>;
      };
      expect(promptsJson.prompts[0].id).toBe(promptId);
      expect(promptsJson.prompts[0].state).toBe("failed");
      expect(promptsJson.prompts[0].errorCode).toBe("codex_unavailable");
    } finally {
      await app.close();
    }
  });

  it("enforces remote prompt consent, idempotency, and lease re-queue behavior", async () => {
    let now = new Date("2026-07-26T12:00:00.000Z");
    const config: RelayConfig = {
      ...relayConfig(),
      promptLeaseSeconds: 1
    };
    const store = new RelayStore(config, { now: () => now });
    const app = createRelayServer({ config, store });

    try {
      const issue = await app.inject({
        method: "POST",
        url: "/v1/pairing/codes",
        headers: { "x-relay-bootstrap-key": "test-bootstrap" },
        payload: { userId: "user-prompt-d" }
      });
      const pairingCode = (issue.json() as { pairingCode: string }).pairingCode;
      const exchange = await app.inject({
        method: "POST",
        url: "/v1/pairing/exchange",
        payload: { pairingCode, deviceName: "user-prompt-d-device" }
      });
      const token = (exchange.json() as { deviceToken: string }).deviceToken;

      await app.inject({
        method: "POST",
        url: "/v1/daemon/heartbeat",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          daemonVersion: "0.2.0",
          sessions: [{ id: "session-d", tool: "codex_cli", status: "active", remotePromptConsent: false }]
        }
      });
      const sessionsResponse = await app.inject({
        method: "GET",
        url: "/v1/sessions",
        headers: { authorization: `Bearer ${token}` }
      });
      const sessionRows = (sessionsResponse.json() as {
        sessions: Array<{ id: string; relaySessionId: string }>;
      }).sessions;
      const relaySession = sessionRows.find((session) => session.id === "session-d");
      if (!relaySession) {
        throw new Error("Expected session-d to be present in relay session list.");
      }
      const relaySessionId = relaySession.relaySessionId;

      const blocked = await app.inject({
        method: "POST",
        url: "/v1/prompts",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          relaySessionId,
          text: "Try prompt without consent.",
          clientPromptId: "client-prompt-4"
        }
      });
      expect(blocked.statusCode).toBe(403);

      await app.inject({
        method: "POST",
        url: "/v1/daemon/heartbeat",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          daemonVersion: "0.2.0",
          sessions: [{ id: "session-d", tool: "codex_cli", status: "active", remotePromptConsent: true }]
        }
      });

      const firstSubmit = await app.inject({
        method: "POST",
        url: "/v1/prompts",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          relaySessionId,
          text: "Execute idempotent prompt.",
          clientPromptId: "idempotent-1"
        }
      });
      const secondSubmit = await app.inject({
        method: "POST",
        url: "/v1/prompts",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          relaySessionId,
          text: "Execute idempotent prompt.",
          clientPromptId: "idempotent-1"
        }
      });
      const firstPromptId = (firstSubmit.json() as { promptId: string }).promptId;
      const secondPromptId = (secondSubmit.json() as { promptId: string }).promptId;
      expect(firstPromptId).toBe(secondPromptId);

      const firstDequeue = await app.inject({
        method: "GET",
        url: "/v1/daemon/prompts?limit=10",
        headers: { authorization: `Bearer ${token}` }
      });
      expect((firstDequeue.json() as { prompts: unknown[] }).prompts).toHaveLength(1);

      now = new Date(now.getTime() + 2_000);
      const secondDequeue = await app.inject({
        method: "GET",
        url: "/v1/daemon/prompts?limit=10",
        headers: { authorization: `Bearer ${token}` }
      });
      expect((secondDequeue.json() as { prompts: unknown[] }).prompts).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});
