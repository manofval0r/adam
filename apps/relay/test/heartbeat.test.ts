import { describe, expect, it } from "vitest";
import { createRelayServer } from "../src/server.js";
import { RelayStore } from "../src/store.js";
import type { RelayConfig } from "../src/types.js";

describe("relay heartbeat and reconnect behavior", () => {
  it("rejects heartbeat without bearer token", async () => {
    const config: RelayConfig = {
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
    const app = createRelayServer({ config });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/daemon/heartbeat",
        payload: {
          daemonVersion: "0.1.0",
          sessions: []
        }
      });

      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("updates sessions and toggles disconnected/connected based on heartbeat staleness", async () => {
    let now = new Date("2026-07-26T10:00:00.000Z");
    const config: RelayConfig = {
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
    const store = new RelayStore(config, { now: () => now });
    const app = createRelayServer({ config, store });

    try {
      const issued = await app.inject({
        method: "POST",
        url: "/v1/pairing/codes",
        headers: {
          "x-relay-bootstrap-key": "test-bootstrap"
        },
        payload: {
          userId: "user-3"
        }
      });
      const issuedJson = issued.json() as { pairingCode: string };

      const exchanged = await app.inject({
        method: "POST",
        url: "/v1/pairing/exchange",
        payload: {
          pairingCode: issuedJson.pairingCode,
          deviceName: "Workstation"
        }
      });
      const exchangedJson = exchanged.json() as { deviceToken: string };

      const heartbeat = await app.inject({
        method: "POST",
        url: "/v1/daemon/heartbeat",
        headers: {
          authorization: `Bearer ${exchangedJson.deviceToken}`
        },
        payload: {
          daemonVersion: "0.1.0",
          sessions: [
            {
              id: "session-1",
              tool: "codex_cli",
              status: "active",
              branch: "main"
            }
          ]
        }
      });

      expect(heartbeat.statusCode).toBe(200);

      const sessionsOnline = await app.inject({
        method: "GET",
        url: "/v1/sessions",
        headers: {
          authorization: `Bearer ${exchangedJson.deviceToken}`
        }
      });
      const sessionsOnlineJson = sessionsOnline.json() as { sessions: Array<{ status: string }> };
      expect(sessionsOnlineJson.sessions).toHaveLength(1);
      expect(sessionsOnlineJson.sessions[0].status).toBe("active");

      now = new Date(now.getTime() + 31_000);
      const devicesDisconnected = await app.inject({
        method: "GET",
        url: "/v1/devices",
        headers: {
          authorization: `Bearer ${exchangedJson.deviceToken}`
        }
      });
      const devicesDisconnectedJson = devicesDisconnected.json() as {
        devices: Array<{ status: string; reconnectCount: number; tokenHash?: string }>;
      };
      expect(devicesDisconnectedJson.devices[0].status).toBe("disconnected");
      expect(devicesDisconnectedJson.devices[0].tokenHash).toBeUndefined();

      const heartbeatReconnect = await app.inject({
        method: "POST",
        url: "/v1/daemon/heartbeat",
        headers: {
          authorization: `Bearer ${exchangedJson.deviceToken}`
        },
        payload: {
          daemonVersion: "0.1.0",
          sessions: [
            {
              id: "session-1",
              tool: "codex_cli",
              status: "idle",
              branch: "main"
            }
          ]
        }
      });

      expect(heartbeatReconnect.statusCode).toBe(200);
      const reconnectJson = heartbeatReconnect.json() as { reconnectCount: number };
      expect(reconnectJson.reconnectCount).toBe(1);

      const anonymousList = await app.inject({
        method: "GET",
        url: "/v1/sessions"
      });
      expect(anonymousList.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("enforces user scope from token and prevents cross-user listing", async () => {
    const config: RelayConfig = {
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
    const app = createRelayServer({ config });

    try {
      const issueA = await app.inject({
        method: "POST",
        url: "/v1/pairing/codes",
        headers: { "x-relay-bootstrap-key": "test-bootstrap" },
        payload: { userId: "user-a" }
      });
      const codeA = (issueA.json() as { pairingCode: string }).pairingCode;
      const exchangeA = await app.inject({
        method: "POST",
        url: "/v1/pairing/exchange",
        payload: { pairingCode: codeA, deviceName: "A-device" }
      });
      const tokenA = (exchangeA.json() as { deviceToken: string }).deviceToken;

      const issueB = await app.inject({
        method: "POST",
        url: "/v1/pairing/codes",
        headers: { "x-relay-bootstrap-key": "test-bootstrap" },
        payload: { userId: "user-b" }
      });
      const codeB = (issueB.json() as { pairingCode: string }).pairingCode;
      const exchangeB = await app.inject({
        method: "POST",
        url: "/v1/pairing/exchange",
        payload: { pairingCode: codeB, deviceName: "B-device" }
      });
      const tokenB = (exchangeB.json() as { deviceToken: string }).deviceToken;

      await app.inject({
        method: "POST",
        url: "/v1/daemon/heartbeat",
        headers: { authorization: `Bearer ${tokenA}` },
        payload: {
          daemonVersion: "0.1.0",
          sessions: [{ id: "session-a", tool: "codex_cli", status: "active" }]
        }
      });
      await app.inject({
        method: "POST",
        url: "/v1/daemon/heartbeat",
        headers: { authorization: `Bearer ${tokenB}` },
        payload: {
          daemonVersion: "0.1.0",
          sessions: [{ id: "session-b", tool: "codex_cli", status: "active" }]
        }
      });

      const sessionsA = await app.inject({
        method: "GET",
        url: "/v1/sessions",
        headers: { authorization: `Bearer ${tokenA}` }
      });
      const sessionsAJson = sessionsA.json() as { userId: string; sessions: Array<{ id: string }> };
      expect(sessionsAJson.userId).toBe("user-a");
      expect(sessionsAJson.sessions.map((session) => session.id)).toEqual(["session-a"]);

      const devicesA = await app.inject({
        method: "GET",
        url: "/v1/devices",
        headers: { authorization: `Bearer ${tokenA}` }
      });
      const devicesAJson = devicesA.json() as { userId: string; devices: Array<{ name: string }> };
      expect(devicesAJson.userId).toBe("user-a");
      expect(devicesAJson.devices).toHaveLength(1);
      expect(devicesAJson.devices[0].name).toBe("A-device");
    } finally {
      await app.close();
    }
  });

  it("rejects expired device tokens", async () => {
    let now = new Date("2026-07-26T10:00:00.000Z");
    const config: RelayConfig = {
      environment: "test",
      host: "127.0.0.1",
      port: 8787,
      pairingCodeTtlSeconds: 180,
      heartbeatStaleSeconds: 30,
      promptLeaseSeconds: 60,
      deviceTokenTtlDays: 1,
      enforceTlsInProduction: false,
      trustProxy: false,
      trustedProxyIps: [],
      allowInMemoryStoreInProduction: false,
      bootstrapApiKey: "test-bootstrap"
    };
    const store = new RelayStore(config, { now: () => now });
    const app = createRelayServer({ config, store });

    try {
      const issue = await app.inject({
        method: "POST",
        url: "/v1/pairing/codes",
        headers: { "x-relay-bootstrap-key": "test-bootstrap" },
        payload: { userId: "user-expiring" }
      });
      const code = (issue.json() as { pairingCode: string }).pairingCode;
      const exchange = await app.inject({
        method: "POST",
        url: "/v1/pairing/exchange",
        payload: { pairingCode: code, deviceName: "Expiring device" }
      });
      const token = (exchange.json() as { deviceToken: string }).deviceToken;

      now = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1_000);
      const heartbeat = await app.inject({
        method: "POST",
        url: "/v1/daemon/heartbeat",
        headers: { authorization: `Bearer ${token}` },
        payload: { daemonVersion: "0.1.0", sessions: [] }
      });

      expect(heartbeat.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
