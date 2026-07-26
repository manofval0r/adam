import { describe, expect, it } from "vitest";
import { createRelayServer } from "../src/server.js";
import type { RelayConfig } from "../src/types.js";

function baseConfig(): RelayConfig {
  return {
    environment: "production",
    host: "127.0.0.1",
    port: 8787,
    pairingCodeTtlSeconds: 180,
    heartbeatStaleSeconds: 30,
    deviceTokenTtlDays: 30,
    enforceTlsInProduction: true,
    trustProxy: false,
    trustedProxyIps: [],
    allowInMemoryStoreInProduction: true,
    bootstrapApiKey: "test-bootstrap"
  };
}

describe("transport enforcement", () => {
  it("fails to boot in production when in-memory store is not explicitly allowed", () => {
    expect(() =>
      createRelayServer({
        config: {
          ...baseConfig(),
          allowInMemoryStoreInProduction: false
        }
      })
    ).toThrowError(/In-memory relay store is disabled in production\./);
  });

  it("fails to boot in production when trust proxy is enabled without trusted proxy IPs", () => {
    expect(() =>
      createRelayServer({
        config: {
          ...baseConfig(),
          trustProxy: true
        }
      })
    ).toThrowError(/RELAY_TRUSTED_PROXY_IPS must be set/);
  });

  it("rejects insecure production traffic even with spoofed x-forwarded-proto", async () => {
    const app = createRelayServer({ config: baseConfig() });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/health",
        headers: {
          "x-forwarded-proto": "https"
        }
      });

      expect(response.statusCode).toBe(426);
    } finally {
      await app.close();
    }
  });

  it("allows local development traffic", async () => {
    const app = createRelayServer({
      config: {
        ...baseConfig(),
        environment: "development"
      }
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/health"
      });
      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("accepts forwarded https only from trusted proxy sources", async () => {
    const app = createRelayServer({
      config: {
        ...baseConfig(),
        trustProxy: true,
        trustedProxyIps: ["127.0.0.1"]
      }
    });

    try {
      const trusted = await app.inject({
        method: "GET",
        url: "/health",
        remoteAddress: "127.0.0.1",
        headers: {
          "x-forwarded-proto": "https"
        }
      });
      expect(trusted.statusCode).toBe(200);

      const untrusted = await app.inject({
        method: "GET",
        url: "/health",
        remoteAddress: "203.0.113.25",
        headers: {
          "x-forwarded-proto": "https"
        }
      });
      expect(untrusted.statusCode).toBe(426);
    } finally {
      await app.close();
    }
  });
});
