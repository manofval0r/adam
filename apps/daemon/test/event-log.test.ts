import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import { EventEnvelopeSchema } from "@adam/contracts";
import { EventLogWriter, resolveEventLogPath } from "../src/event-log.js";
import type { ActivityPayload, DaemonEventEnvelope } from "../src/types.js";

function writeSampleEvents(): string {
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

  return logPath;
}

function readLogLines(logPath: string): string[] {
  return readFileSync(logPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
}

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

  it("writes events that satisfy the shared envelope schema", () => {
    const logPath = writeSampleEvents();

    for (const line of readLogLines(logPath)) {
      expect(EventEnvelopeSchema.safeParse(JSON.parse(line)).success).toBe(true);
    }

    // The envelope keeps one event type per event, so widening the shared
    // union cannot let an arbitrary payload pair with an arbitrary type.
    expectTypeOf<DaemonEventEnvelope<"activity", ActivityPayload>["type"]>().toEqualTypeOf<"activity">();
  });
});
