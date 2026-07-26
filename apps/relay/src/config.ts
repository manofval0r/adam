import type { RelayConfig } from "./types.js";

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

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  const normalized = value.toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }
  return fallback;
}

function parseCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  const seen = new Set<string>();
  const parsed: string[] = [];
  for (const item of value.split(",")) {
    const normalized = item.trim();
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    parsed.push(normalized);
  }
  return parsed;
}

function parseEnvironment(value: string | undefined): "production" | "development" | "test" {
  const normalized = value?.toLowerCase();
  if (normalized === "production") {
    return "production";
  }
  if (normalized === "test") {
    return "test";
  }
  if (normalized === "development") {
    return "development";
  }
  return "production";
}

export function loadRelayConfig(): RelayConfig {
  const environment = parseEnvironment(process.env.RELAY_ENV ?? process.env.NODE_ENV);
  const bootstrapApiKey = process.env.RELAY_BOOTSTRAP_API_KEY ?? "";

  if (environment === "production" && bootstrapApiKey.length === 0) {
    throw new Error("RELAY_BOOTSTRAP_API_KEY must be set in production.");
  }

  return {
    environment,
    host: process.env.RELAY_HOST ?? "127.0.0.1",
    port: parseInteger(process.env.RELAY_PORT, 8787),
    pairingCodeTtlSeconds: parseInteger(process.env.RELAY_PAIRING_CODE_TTL_SECONDS, 180),
    heartbeatStaleSeconds: parseInteger(process.env.RELAY_HEARTBEAT_STALE_SECONDS, 45),
    deviceTokenTtlDays: parseInteger(process.env.RELAY_DEVICE_TOKEN_TTL_DAYS, 30),
    enforceTlsInProduction: parseBoolean(process.env.RELAY_ENFORCE_TLS_PRODUCTION, true),
    trustProxy: parseBoolean(process.env.RELAY_TRUST_PROXY, false),
    trustedProxyIps: parseCsv(process.env.RELAY_TRUSTED_PROXY_IPS),
    allowInMemoryStoreInProduction: parseBoolean(process.env.RELAY_ALLOW_IN_MEMORY_STORE_PRODUCTION, false),
    bootstrapApiKey
  };
}
