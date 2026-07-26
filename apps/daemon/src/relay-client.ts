import type { DaemonHeartbeatInput } from "./types.js";

export interface RelayQueuedPrompt {
  promptId: string;
  sessionId: string;
  text: string;
  createdAt: string;
  leaseExpiresAt: string;
  correlationId: string;
}

export interface RelayPromptStatusUpdate {
  state: "adapter_sent" | "acknowledged" | "failed";
  errorCode?: string;
  errorMessage?: string;
  assistantText?: string;
}

interface JsonResponse {
  [key: string]: unknown;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

async function requestJson(
  method: "GET" | "POST",
  url: string,
  token: string,
  timeoutMs: number,
  body?: unknown
): Promise<JsonResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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

    const response = await fetch(url, init);

    let parsed: JsonResponse = {};
    try {
      parsed = (await response.json()) as JsonResponse;
    } catch {
      parsed = {};
    }

    if (!response.ok) {
      const errorCode = typeof parsed.error === "string" ? parsed.error : "relay_request_failed";
      const errorMessage = typeof parsed.message === "string" ? parsed.message : `Relay request failed with ${response.status}.`;
      throw new Error(`${errorCode}: ${errorMessage}`);
    }

    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

export async function postRelayHeartbeat(
  baseUrl: string,
  token: string,
  timeoutMs: number,
  heartbeat: DaemonHeartbeatInput
): Promise<void> {
  await requestJson("POST", `${normalizeBaseUrl(baseUrl)}/v1/daemon/heartbeat`, token, timeoutMs, heartbeat);
}

export async function dequeueRelayPrompts(
  baseUrl: string,
  token: string,
  timeoutMs: number,
  limit: number
): Promise<RelayQueuedPrompt[]> {
  const payload = await requestJson(
    "GET",
    `${normalizeBaseUrl(baseUrl)}/v1/daemon/prompts?limit=${limit}`,
    token,
    timeoutMs
  );
  const promptsValue = payload.prompts;
  if (!Array.isArray(promptsValue)) {
    throw new Error("relay_invalid_prompts_payload: Relay prompts response is invalid.");
  }

  return promptsValue.map((item) => {
    if (typeof item !== "object" || item === null) {
      throw new Error("relay_invalid_prompt_item: Relay prompt item is invalid.");
    }
    const typed = item as Record<string, unknown>;
    const promptId = typed.promptId;
    const sessionId = typed.sessionId;
    const text = typed.text;
    const createdAt = typed.createdAt;
    const leaseExpiresAt = typed.leaseExpiresAt;
    const correlationId = typed.correlationId;
    if (
      typeof promptId !== "string" ||
      typeof sessionId !== "string" ||
      typeof text !== "string" ||
      typeof createdAt !== "string" ||
      typeof leaseExpiresAt !== "string" ||
      typeof correlationId !== "string"
    ) {
      throw new Error("relay_invalid_prompt_item: Relay prompt item is missing required fields.");
    }
    return {
      promptId,
      sessionId,
      text,
      createdAt,
      leaseExpiresAt,
      correlationId
    };
  });
}

export async function updateRelayPromptStatus(
  baseUrl: string,
  token: string,
  timeoutMs: number,
  promptId: string,
  status: RelayPromptStatusUpdate
): Promise<void> {
  await requestJson(
    "POST",
    `${normalizeBaseUrl(baseUrl)}/v1/daemon/prompts/${encodeURIComponent(promptId)}/status`,
    token,
    timeoutMs,
    status
  );
}
