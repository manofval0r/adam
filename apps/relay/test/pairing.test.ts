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
    heartbeatStaleSeconds: 45,
    deviceTokenTtlDays: 30,
    enforceTlsInProduction: false,
    trustProxy: false,
    trustedProxyIps: [],
    allowInMemoryStoreInProduction: false,
    bootstrapApiKey: "test-bootstrap"
  };
}

describe("relay pairing flow", () => {
  it("issues pairing code and exchanges to device token", async () => {
    const app = createRelayServer({ config: relayConfig() });
    try {
      const issue = await app.inject({
        method: "POST",
        url: "/v1/pairing/codes",
        headers: {
          "x-relay-bootstrap-key": "test-bootstrap"
        },
        payload: {
          userId: "user-1",
          userName: "Dev User"
        }
      });

      expect(issue.statusCode).toBe(201);
      const issueJson = issue.json() as { pairingCode: string; userId: string };
      expect(issueJson.userId).toBe("user-1");
      expect(issueJson.pairingCode.length).toBe(8);

      const exchange = await app.inject({
        method: "POST",
        url: "/v1/pairing/exchange",
        payload: {
          pairingCode: issueJson.pairingCode,
          deviceName: "Laptop Daemon"
        }
      });

      expect(exchange.statusCode).toBe(201);
      const exchangeJson = exchange.json() as { deviceId: string; deviceToken: string; userId: string };
      expect(exchangeJson.userId).toBe("user-1");
      expect(exchangeJson.deviceId.startsWith("dev_")).toBe(true);
      expect(exchangeJson.deviceToken.length).toBeGreaterThan(20);
    } finally {
      await app.close();
    }
  });

  it("rejects pairing code reuse", async () => {
    const app = createRelayServer({ config: relayConfig() });
    try {
      const issue = await app.inject({
        method: "POST",
        url: "/v1/pairing/codes",
        headers: {
          "x-relay-bootstrap-key": "test-bootstrap"
        },
        payload: { userId: "user-2" }
      });
      const issueJson = issue.json() as { pairingCode: string };

      const first = await app.inject({
        method: "POST",
        url: "/v1/pairing/exchange",
        payload: {
          pairingCode: issueJson.pairingCode,
          deviceName: "Device A"
        }
      });
      expect(first.statusCode).toBe(201);

      const second = await app.inject({
        method: "POST",
        url: "/v1/pairing/exchange",
        payload: {
          pairingCode: issueJson.pairingCode,
          deviceName: "Device B"
        }
      });
      expect(second.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });

  it("rejects pairing code requests without bootstrap key", async () => {
    const app = createRelayServer({ config: relayConfig() });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/pairing/codes",
        payload: { userId: "user-3" }
      });

      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("rejects expired pairing code exchange", async () => {
    let now = new Date("2026-07-26T10:00:00.000Z");
    const config: RelayConfig = {
      ...relayConfig(),
      pairingCodeTtlSeconds: 1
    };
    const store = new RelayStore(config, { now: () => now });
    const app = createRelayServer({ config, store });

    try {
      const issue = await app.inject({
        method: "POST",
        url: "/v1/pairing/codes",
        headers: {
          "x-relay-bootstrap-key": "test-bootstrap"
        },
        payload: { userId: "user-4" }
      });
      const issueJson = issue.json() as { pairingCode: string };

      now = new Date(now.getTime() + 2_000);
      const exchange = await app.inject({
        method: "POST",
        url: "/v1/pairing/exchange",
        payload: {
          pairingCode: issueJson.pairingCode,
          deviceName: "Too Late Device"
        }
      });

      expect(exchange.statusCode).toBe(410);
    } finally {
      await app.close();
    }
  });
});
