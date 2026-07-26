import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EventLogWriter, resolveEventLogPath } from "../src/event-log.js";

describe("event log", () => {
  it("appends session and activity events as jsonl", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "adam-events-"));
    const logPath = resolveEventLogPath(stateDir, "events.jsonl");

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

    writer.emitSessionStartedEvent("session-1", {
      tool: "codex_cli",
      mode: "detected"
    });
    writer.emitActivityEvent("session-1", {
      title: "Codex probe",
      status: "completed",
      category: "syncing"
    });

    const rows = readFileSync(logPath, "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));

    expect(rows).toHaveLength(2);
    expect(rows[0].type).toBe("session_started");
    expect(rows[0].sequence).toBe(1);
    expect(rows[1].type).toBe("activity");
    expect(rows[1].sequence).toBe(2);
  });
});
