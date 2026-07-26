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
}

export interface LoadedDaemonConfig {
  cwd: string;
  projectRoot: string | null;
  stateDir: string;
  codexBinary: string;
  codexSessionsDir: string;
  logFileName: string;
  configPath: string | null;
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
    configPath
  };
}
