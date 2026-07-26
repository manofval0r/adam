import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runRelayWorkerOnce } from "../src/prompt-worker.js";
import type { DaemonHeartbeatInput } from "../src/types.js";

function setupProject(config: Record<string, unknown>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "adam-worker-"));
  mkdirSync(path.join(root, ".git"));
  mkdirSync(path.join(root, ".adam"), { recursive: true });
  const merged = {
    codexSessionsDir: path.join(root, ".adam", "sessions"),
    ...config
  };
  mkdirSync(path.join(root, ".adam", "sessions"), { recursive: true });
  writeFileSync(path.join(root, ".adam", "config.json"), JSON.stringify(merged, null, 2), "utf8");
  return root;
}

describe("relay prompt worker", () => {
  it("sends heartbeat, executes prompt, and acknowledges delivery", async () => {
    const root = setupProject({
      relayBaseUrl: "http://relay.local",
      relayDeviceToken: "token-1",
      relayPromptPollLimit: 10,
      relayRequestTimeoutMs: 2000,
      codexExecTimeoutMs: 1000,
      codexBinary: "node"
    });

    const updates: Array<{ state: string; promptId: string }> = [];
    const heartbeats: DaemonHeartbeatInput[] = [];

    const result = await runRelayWorkerOnce(root, {
      sendHeartbeat: async (_baseUrl, _token, _timeoutMs, heartbeat) => {
        heartbeats.push(heartbeat);
      },
      dequeuePrompts: async () => [
        {
          promptId: "prompt-1",
          sessionId: "local-session",
          text: "Run tests and summarize failures.",
          createdAt: "2026-07-26T12:00:00.000Z",
          leaseExpiresAt: "2099-01-01T00:00:00.000Z",
          correlationId: "prompt-1"
        }
      ],
      updatePromptStatus: async (_baseUrl, _token, _timeoutMs, promptId, status) => {
        updates.push({ state: status.state, promptId });
      },
      executePrompt: (_binary, _prompt, _sessionId) => ({
        ok: true,
        assistantText: "Tests failed in auth suite."
      })
    });

    expect(heartbeats).toHaveLength(1);
    expect(result.status).toBe("processed");
    expect(result.promptsFetched).toBe(1);
    expect(result.promptsAcknowledged).toBe(1);
    expect(result.promptsFailed).toBe(0);
    expect(updates).toEqual([
      { state: "adapter_sent", promptId: "prompt-1" },
      { state: "acknowledged", promptId: "prompt-1" }
    ]);
  });

  it("marks prompts failed when codex is unavailable", async () => {
    const root = setupProject({
      relayBaseUrl: "http://relay.local",
      relayDeviceToken: "token-2",
      relayPromptPollLimit: 5,
      relayRequestTimeoutMs: 2000,
      codexBinary: "codex-binary-that-does-not-exist"
    });

    const updates: Array<{ state: string; errorCode?: string }> = [];
    const result = await runRelayWorkerOnce(root, {
      sendHeartbeat: async () => {},
      dequeuePrompts: async () => [
        {
          promptId: "prompt-2",
          sessionId: "session-2",
          text: "Continue milestone work.",
          createdAt: "2026-07-26T12:01:00.000Z",
          leaseExpiresAt: "2099-01-01T00:00:00.000Z",
          correlationId: "prompt-2"
        }
      ],
      updatePromptStatus: async (_baseUrl, _token, _timeoutMs, _promptId, status) => {
        updates.push({
          state: status.state,
          errorCode: status.errorCode
        });
      },
      executePrompt: () => {
        throw new Error("executePrompt should not be called when Codex is unavailable");
      }
    });

    expect(result.status).toBe("processed");
    expect(result.promptsFetched).toBe(1);
    expect(result.promptsAcknowledged).toBe(0);
    expect(result.promptsFailed).toBe(1);
    expect(updates).toEqual([
      {
        state: "failed",
        errorCode: "codex_unavailable"
      }
    ]);
  });

  it("fails prompt when selected session is not attached on daemon", async () => {
    const root = setupProject({
      relayBaseUrl: "http://relay.local",
      relayDeviceToken: "token-3",
      relayPromptPollLimit: 5,
      relayRequestTimeoutMs: 2000,
      codexBinary: "node"
    });

    const updates: Array<{ state: string; errorCode?: string }> = [];
    const result = await runRelayWorkerOnce(root, {
      sendHeartbeat: async () => {},
      dequeuePrompts: async () => [
        {
          promptId: "prompt-3",
          sessionId: "another-session",
          text: "Mismatched session",
          createdAt: "2026-07-26T12:02:00.000Z",
          leaseExpiresAt: "2099-01-01T00:00:00.000Z",
          correlationId: "prompt-3"
        }
      ],
      updatePromptStatus: async (_baseUrl, _token, _timeoutMs, _promptId, status) => {
        updates.push({
          state: status.state,
          errorCode: status.errorCode
        });
      },
      executePrompt: () => {
        throw new Error("executePrompt should not run for mismatched session");
      }
    });

    expect(result.promptsFetched).toBe(1);
    expect(result.promptsAcknowledged).toBe(0);
    expect(result.promptsFailed).toBe(1);
    expect(updates).toEqual([
      {
        state: "failed",
        errorCode: "session_not_attached"
      }
    ]);
  });
});
