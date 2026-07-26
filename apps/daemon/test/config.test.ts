import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getProjectConfigPath, loadDaemonConfig } from "../src/config.js";

describe("daemon config", () => {
  it("loads project config when present", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "adam-config-"));
    mkdirSync(path.join(repoRoot, ".git"));
    mkdirSync(path.join(repoRoot, ".adam"), { recursive: true });

    const configPath = getProjectConfigPath(repoRoot);
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          stateDir: path.join(repoRoot, ".adam", "custom-state"),
          codexBinary: "codex-custom",
          logFileName: "custom-events.jsonl",
          relayBaseUrl: "http://127.0.0.1:8787",
          relayDeviceToken: "device-token",
          relayRequestTimeoutMs: 9000,
          relayPromptPollLimit: 7,
          relayPollIntervalMs: 4000,
          remotePromptConsent: true,
          codexExecTimeoutMs: 240000
        },
        null,
        2
      ),
      "utf8"
    );

    const loaded = loadDaemonConfig(path.join(repoRoot, "src"));
    expect(loaded.projectRoot).toBe(repoRoot);
    expect(loaded.configPath).toBe(configPath);
    expect(loaded.stateDir).toBe(path.join(repoRoot, ".adam", "custom-state"));
    expect(loaded.codexBinary).toBe("codex-custom");
    expect(loaded.logFileName).toBe("custom-events.jsonl");
    expect(loaded.relayBaseUrl).toBe("http://127.0.0.1:8787");
    expect(loaded.relayDeviceToken).toBe("device-token");
    expect(loaded.relayRequestTimeoutMs).toBe(9000);
    expect(loaded.relayPromptPollLimit).toBe(7);
    expect(loaded.relayPollIntervalMs).toBe(4000);
    expect(loaded.remotePromptConsent).toBe(true);
    expect(loaded.codexExecTimeoutMs).toBe(240000);
  });
});
