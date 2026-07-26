import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export interface CodexAvailability {
  available: boolean;
  version?: string;
  error?: string;
}

export interface CodexSessionCandidate {
  sessionId: string;
  filePath: string;
  modifiedAt: string;
}

export interface CodexPromptExecutionResult {
  ok: boolean;
  assistantText?: string;
  errorCode?: string;
  errorMessage?: string;
}

export function detectCodexAvailability(binary: string): CodexAvailability {
  const result = spawnSync(binary, ["--version"], {
    encoding: "utf8",
    timeout: 8_000
  });

  if (result.error) {
    return {
      available: false,
      error: result.error.message
    };
  }

  if (result.status !== 0) {
    return {
      available: false,
      error: (result.stderr || result.stdout || "codex --version failed").trim()
    };
  }

  return {
    available: true,
    version: (result.stdout || result.stderr || "").trim()
  };
}

function walkJsonlFiles(baseDirectory: string): string[] {
  if (!existsSync(baseDirectory)) {
    return [];
  }

  const stack = [baseDirectory];
  const files: string[] = [];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

export function discoverLatestCodexSession(sessionsDirectory: string): CodexSessionCandidate | null {
  const files = walkJsonlFiles(sessionsDirectory);
  if (files.length === 0) {
    return null;
  }

  let latest: { filePath: string; mtimeMs: number } | null = null;

  for (const filePath of files) {
    const stats = statSync(filePath);
    if (!latest || stats.mtimeMs > latest.mtimeMs) {
      latest = {
        filePath,
        mtimeMs: stats.mtimeMs
      };
    }
  }

  if (!latest) {
    return null;
  }

  return {
    sessionId: path.basename(latest.filePath, ".jsonl"),
    filePath: latest.filePath,
    modifiedAt: new Date(latest.mtimeMs).toISOString()
  };
}

export function executeCodexPrompt(
  binary: string,
  prompt: string,
  sessionId: string,
  cwd: string,
  timeoutMs: number
): CodexPromptExecutionResult {
  const normalizedPrompt = prompt.trim();
  if (normalizedPrompt.length === 0) {
    return {
      ok: false,
      errorCode: "invalid_prompt",
      errorMessage: "Prompt cannot be empty."
    };
  }

  const commandArgs = ["exec", "resume", sessionId, "--json"];
  const result = spawnSync(binary, commandArgs, {
    cwd,
    input: normalizedPrompt,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024
  });

  if (result.error) {
    return {
      ok: false,
      errorCode: "codex_exec_error",
      errorMessage: result.error.message
    };
  }
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || "Codex exec failed.").trim();
    return {
      ok: false,
      errorCode: "codex_exec_failed",
      errorMessage: message
    };
  }

  const assistantText = (result.stdout || "").trim();
  return {
    ok: true,
    assistantText: assistantText.length > 0 ? assistantText : "Prompt delivered successfully."
  };
}
