import { describe, expect, it } from "vitest";
import { EventEnvelopeSchema } from "@adam/contracts";
import { createRelayServer } from "../src/server.js";
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

async function submitPromptViaRelay(
  app: ReturnType<typeof createRelayServer>,
  authHeaders: Record<string, string>,
  relaySessionId: string
): Promise<void> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/prompts",
    headers: authHeaders,
    payload: {
      relaySessionId,
      text: "Summarise the failing test.",
      clientPromptId: "contracts-client-prompt-1"
    }
  });
  expect(response.statusCode).toBe(202);
}

describe("relay event conformance", () => {
  it("emits events that satisfy the shared envelope schema", async () => {
    const app = createRelayServer({ config: relayConfig() });
    try {
      const paired = await pairDeviceAndStartSession(app, "user-contracts", "session-contracts");
      const authHeaders = { authorization: `Bearer ${paired.deviceToken}` };
      await submitPromptViaRelay(app, authHeaders, paired.relaySessionId);

      const response = await app.inject({
        method: "GET",
        url: "/v1/events",
        headers: authHeaders
      });
      expect(response.statusCode).toBe(200);

      const body = response.json() as {
        userId: string;
        sinceSequence: number;
        lastSequence: number;
        events: unknown[];
      };

      // The response envelope around the events is unchanged.
      expect(Object.keys(body).sort()).toEqual(["events", "lastSequence", "sinceSequence", "userId"]);
      expect(body.events.length).toBeGreaterThan(0);

      for (const event of body.events) {
        expect(EventEnvelopeSchema.safeParse(event).success).toBe(true);
      }
    } finally {
      await app.close();
    }
  });
});
