import { executeCodexPrompt, type CodexPromptExecutionResult } from "./codex.js";
import { gatherDaemonHealth } from "./health.js";
import { dequeueRelayPrompts, postRelayHeartbeat, updateRelayPromptStatus, type RelayQueuedPrompt } from "./relay-client.js";
import type { DaemonHeartbeatInput } from "./types.js";

export interface RelayWorkerResult {
  status: "processed" | "no_prompts";
  promptsFetched: number;
  promptsAcknowledged: number;
  promptsFailed: number;
}

export interface RelayWorkerDependencies {
  sendHeartbeat: (baseUrl: string, token: string, timeoutMs: number, heartbeat: DaemonHeartbeatInput) => Promise<void>;
  dequeuePrompts: (baseUrl: string, token: string, timeoutMs: number, limit: number) => Promise<RelayQueuedPrompt[]>;
  updatePromptStatus: (
    baseUrl: string,
    token: string,
    timeoutMs: number,
    promptId: string,
    status: { state: "adapter_sent" | "acknowledged" | "failed"; errorCode?: string; errorMessage?: string; assistantText?: string }
  ) => Promise<void>;
  executePrompt: (
    binary: string,
    prompt: string,
    sessionId: string,
    cwd: string,
    timeoutMs: number
  ) => CodexPromptExecutionResult;
}

function assertRelayConfig(baseUrl: string | null, token: string | null): { baseUrl: string; token: string } {
  if (!baseUrl || baseUrl.trim().length === 0) {
    throw new Error("Adam relay base URL is missing. Configure relayBaseUrl or ADAM_RELAY_BASE_URL.");
  }
  if (!token || token.trim().length === 0) {
    throw new Error("Adam relay device token is missing. Configure relayDeviceToken or ADAM_RELAY_DEVICE_TOKEN.");
  }
  return {
    baseUrl: baseUrl.trim(),
    token: token.trim()
  };
}

export async function runRelayWorkerOnce(
  cwd: string = process.cwd(),
  dependencies?: Partial<RelayWorkerDependencies>
): Promise<RelayWorkerResult> {
  const { snapshot, config } = gatherDaemonHealth(cwd);
  const relay = assertRelayConfig(config.relayBaseUrl, config.relayDeviceToken);

  const sessionPayload: DaemonHeartbeatInput["sessions"][number] = {
    id: snapshot.codex.latestSession?.sessionId ?? "local-session",
    tool: snapshot.codex.available ? "codex_cli" : "unknown",
    status: snapshot.codex.available ? "active" : "failed",
    remotePromptConsent: config.remotePromptConsent,
    lastActivityAt: new Date().toISOString()
  };
  if (snapshot.projectRoot) {
    sessionPayload.repoPath = snapshot.projectRoot;
  }
  if (snapshot.git.available && snapshot.git.branch) {
    sessionPayload.branch = snapshot.git.branch;
  }

  const heartbeatPayload: DaemonHeartbeatInput = {
    daemonVersion: "0.2.0",
    sessions: [sessionPayload]
  };

  const sendHeartbeat = dependencies?.sendHeartbeat ?? postRelayHeartbeat;
  const dequeuePrompts = dependencies?.dequeuePrompts ?? dequeueRelayPrompts;
  const updatePromptStatus = dependencies?.updatePromptStatus ?? updateRelayPromptStatus;
  const executePrompt = dependencies?.executePrompt ?? executeCodexPrompt;

  await sendHeartbeat(relay.baseUrl, relay.token, config.relayRequestTimeoutMs, heartbeatPayload);
  const prompts = await dequeuePrompts(
    relay.baseUrl,
    relay.token,
    config.relayRequestTimeoutMs,
    config.relayPromptPollLimit
  );
  if (prompts.length === 0) {
    return {
      status: "no_prompts",
      promptsFetched: 0,
      promptsAcknowledged: 0,
      promptsFailed: 0
    };
  }

  let acknowledged = 0;
  let failed = 0;

  for (const prompt of prompts) {
    if (!snapshot.codex.available) {
      failed += 1;
      await updatePromptStatus(relay.baseUrl, relay.token, config.relayRequestTimeoutMs, prompt.promptId, {
        state: "failed",
        errorCode: "codex_unavailable",
        errorMessage: snapshot.codex.error ?? "Codex CLI unavailable on daemon host."
      });
      continue;
    }
    const activeSessionId = snapshot.codex.latestSession?.sessionId ?? "local-session";
    if (activeSessionId !== prompt.sessionId) {
      failed += 1;
      await updatePromptStatus(relay.baseUrl, relay.token, config.relayRequestTimeoutMs, prompt.promptId, {
        state: "failed",
        errorCode: "session_not_attached",
        errorMessage: "Requested session is not currently attached on daemon."
      });
      continue;
    }

    await updatePromptStatus(relay.baseUrl, relay.token, config.relayRequestTimeoutMs, prompt.promptId, {
      state: "adapter_sent"
    });

    const leaseRemainingMs = new Date(prompt.leaseExpiresAt).getTime() - Date.now();
    const executionTimeoutMs = Math.min(config.codexExecTimeoutMs, leaseRemainingMs - 1_500);
    if (!Number.isFinite(executionTimeoutMs) || executionTimeoutMs < 1_000) {
      failed += 1;
      await updatePromptStatus(relay.baseUrl, relay.token, config.relayRequestTimeoutMs, prompt.promptId, {
        state: "failed",
        errorCode: "prompt_lease_expired",
        errorMessage: "Prompt lease expired before Codex execution could start."
      });
      continue;
    }

    const execution = executePrompt(
      config.codexBinary,
      prompt.text,
      prompt.sessionId,
      snapshot.projectRoot ?? config.cwd,
      executionTimeoutMs
    );
    if (!execution.ok) {
      failed += 1;
      await updatePromptStatus(relay.baseUrl, relay.token, config.relayRequestTimeoutMs, prompt.promptId, {
        state: "failed",
        errorCode: execution.errorCode ?? "codex_exec_failed",
        errorMessage: execution.errorMessage ?? "Codex execution failed."
      });
      continue;
    }

    acknowledged += 1;
    const acknowledgedPayload: {
      state: "acknowledged";
      assistantText?: string;
    } = {
      state: "acknowledged"
    };
    if (execution.assistantText) {
      acknowledgedPayload.assistantText = execution.assistantText;
    }

    await updatePromptStatus(
      relay.baseUrl,
      relay.token,
      config.relayRequestTimeoutMs,
      prompt.promptId,
      acknowledgedPayload
    );
  }

  return {
    status: "processed",
    promptsFetched: prompts.length,
    promptsAcknowledged: acknowledged,
    promptsFailed: failed
  };
}
