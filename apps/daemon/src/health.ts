import { detectCodexAvailability, discoverLatestCodexSession, type CodexSessionCandidate } from "./codex.js";
import { loadDaemonConfig, type LoadedDaemonConfig } from "./config.js";
import { findRepoRoot, getGitStatus, type GitStatusSnapshot } from "./git.js";

export interface DaemonHealthSnapshot {
  generatedAt: string;
  status: "ok" | "degraded";
  cwd: string;
  projectRoot: string | null;
  config: {
    configPath: string | null;
    stateDir: string;
    logFileName: string;
  };
  git: GitStatusSnapshot;
  codex: {
    available: boolean;
    version?: string;
    error?: string;
    latestSession: CodexSessionCandidate | null;
  };
}

function computeStatus(git: GitStatusSnapshot, codexAvailable: boolean): "ok" | "degraded" {
  return git.available && codexAvailable ? "ok" : "degraded";
}

export function gatherDaemonHealth(cwd: string = process.cwd()): {
  snapshot: DaemonHealthSnapshot;
  config: LoadedDaemonConfig;
} {
  const config = loadDaemonConfig(cwd);
  const repoRoot = config.projectRoot ?? findRepoRoot(config.cwd);
  const git = repoRoot
    ? getGitStatus(repoRoot)
    : {
        available: false,
        error: "No git repository found from current working directory."
      };

  const codex = detectCodexAvailability(config.codexBinary);
  const latestSession = discoverLatestCodexSession(config.codexSessionsDir);

  const codexSnapshot: DaemonHealthSnapshot["codex"] = {
    available: codex.available,
    latestSession
  };
  if (codex.version) {
    codexSnapshot.version = codex.version;
  }
  if (codex.error) {
    codexSnapshot.error = codex.error;
  }

  const snapshot: DaemonHealthSnapshot = {
    generatedAt: new Date().toISOString(),
    status: computeStatus(git, codex.available),
    cwd: config.cwd,
    projectRoot: repoRoot,
    config: {
      configPath: config.configPath,
      stateDir: config.stateDir,
      logFileName: config.logFileName
    },
    git,
    codex: codexSnapshot
  };

  return { snapshot, config };
}
