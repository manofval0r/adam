import { randomUUID } from "node:crypto";
import { EventLogWriter, resolveEventLogPath } from "./event-log.js";
import { gatherDaemonHealth } from "./health.js";

export interface DaemonRunResult {
  sessionId: string;
  emittedEvents: number;
  logPath: string;
  healthStatus: "ok" | "degraded";
}

export function runDaemonOnce(cwd: string = process.cwd()): DaemonRunResult {
  const { snapshot, config } = gatherDaemonHealth(cwd);

  const logPath = resolveEventLogPath(config.stateDir, config.logFileName);
  const writer = new EventLogWriter(
    logPath,
    {
      kind: "desktop_daemon",
      id: "adam-daemon",
      name: "Adam Daemon",
      version: "0.1.0"
    },
    {
      kind: "system",
      id: "adam-daemon",
      displayName: "Adam Daemon"
    }
  );

  const sessionId = snapshot.codex.latestSession?.sessionId ?? `adam-${randomUUID().slice(0, 12)}`;

  const sessionStartedPayload: {
    tool: "codex_cli" | "unknown";
    mode: "detected" | "resumed" | "created";
    adapterSessionId?: string;
    repoPath?: string;
    branch?: string;
  } = {
    tool: snapshot.codex.available ? "codex_cli" : "unknown",
    mode: snapshot.codex.latestSession ? "resumed" : "detected"
  };

  if (snapshot.codex.latestSession?.sessionId) {
    sessionStartedPayload.adapterSessionId = snapshot.codex.latestSession.sessionId;
  }
  if (snapshot.projectRoot) {
    sessionStartedPayload.repoPath = snapshot.projectRoot;
  }
  if (snapshot.git.branch) {
    sessionStartedPayload.branch = snapshot.git.branch;
  }

  writer.emitSessionStartedEvent(sessionId, sessionStartedPayload);

  writer.emitActivityEvent(sessionId, {
    title: "Repository inspection",
    body: snapshot.projectRoot
      ? `Detected repository at ${snapshot.projectRoot}.`
      : "No repository detected from current working directory.",
    status: snapshot.projectRoot ? "completed" : "blocked",
    category: "searching"
  });

  writer.emitActivityEvent(sessionId, {
    title: "Codex CLI probe",
    body: snapshot.codex.available
      ? `Codex available (${snapshot.codex.version ?? "version unknown"}).`
      : `Codex unavailable (${snapshot.codex.error ?? "unknown error"}).`,
    status: snapshot.codex.available ? "completed" : "blocked",
    category: "syncing"
  });

  return {
    sessionId,
    emittedEvents: 3,
    logPath,
    healthStatus: snapshot.status
  };
}
