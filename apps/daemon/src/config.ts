import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { findRepoRoot } from "./git.js";

export interface DaemonConfig {
  projectRoot?: string;
  stateDir?: string;
  codexBinary?: string;
  codexSessionsDir?: string;
  logFileName?: string;
  relayBaseUrl?: string;
  relayDeviceToken?: string;
  relayRequestTimeoutMs?: number;
  relayPromptPollLimit?: number;
  relayPollIntervalMs?: number;
  remotePromptConsent?: boolean;
  codexExecTimeoutMs?: number;
}

export interface LoadedDaemonConfig {
  cwd: string;
  projectRoot: string | null;
  stateDir: string;
  codexBinary: string;
  codexSessionsDir: string;
  logFileName: string;
  relayBaseUrl: string | null;
  relayDeviceToken: string | null;
  relayRequestTimeoutMs: number;
  relayPromptPollLimit: number;
  relayPollIntervalMs: number;
  remotePromptConsent: boolean;
  codexExecTimeoutMs: number;
  configPath: string | null;
}

function parseInteger(value: number | string | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value !== "string") {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function parseBoolean(value: boolean | string | undefined, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
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

function getDefaultStateRoot(): string {
  if (process.env.ADAM_STATE_DIR) {
    return path.resolve(process.env.ADAM_STATE_DIR);
  }

  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "Adam", "state");
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Adam", "state");
  }

  return path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"), "adam");
}

export function getProjectConfigPath(projectRoot: string): string {
  return path.join(projectRoot, ".adam", "config.json");
}

function readProjectConfig(projectRoot: string): { config: DaemonConfig; configPath: string | null } {
  const configPath = getProjectConfigPath(projectRoot);
  if (!existsSync(configPath)) {
    return { config: {}, configPath: null };
  }

  const raw = readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as DaemonConfig;
  return { config: parsed, configPath };
}

export function loadDaemonConfig(cwd: string = process.cwd()): LoadedDaemonConfig {
  const absoluteCwd = path.resolve(cwd);
  const projectRoot = findRepoRoot(absoluteCwd);

  let fileConfig: DaemonConfig = {};
  let configPath: string | null = null;

  if (projectRoot) {
    const read = readProjectConfig(projectRoot);
    fileConfig = read.config;
    configPath = read.configPath;
  }

  const stateDir = fileConfig.stateDir
    ? path.resolve(fileConfig.stateDir)
    : projectRoot
      ? path.join(projectRoot, ".adam", "state")
      : getDefaultStateRoot();

  return {
    cwd: absoluteCwd,
    projectRoot,
    stateDir,
    codexBinary: fileConfig.codexBinary ?? process.env.CODEX_CLI_PATH ?? "codex",
    codexSessionsDir: fileConfig.codexSessionsDir ?? path.join(os.homedir(), ".codex", "sessions"),
    logFileName: fileConfig.logFileName ?? "events.jsonl",
    relayBaseUrl: fileConfig.relayBaseUrl ?? process.env.ADAM_RELAY_BASE_URL ?? null,
    relayDeviceToken: fileConfig.relayDeviceToken ?? process.env.ADAM_RELAY_DEVICE_TOKEN ?? null,
    relayRequestTimeoutMs: parseInteger(fileConfig.relayRequestTimeoutMs ?? process.env.ADAM_RELAY_REQUEST_TIMEOUT_MS, 10_000),
    relayPromptPollLimit: parseInteger(fileConfig.relayPromptPollLimit ?? process.env.ADAM_RELAY_PROMPT_POLL_LIMIT, 10),
    relayPollIntervalMs: parseInteger(fileConfig.relayPollIntervalMs ?? process.env.ADAM_RELAY_POLL_INTERVAL_MS, 5_000),
    remotePromptConsent: parseBoolean(fileConfig.remotePromptConsent ?? process.env.ADAM_REMOTE_PROMPT_CONSENT, false),
    codexExecTimeoutMs: parseInteger(fileConfig.codexExecTimeoutMs ?? process.env.ADAM_CODEX_EXEC_TIMEOUT_MS, 120_000),
    configPath
  };
}
