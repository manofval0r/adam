import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SCHEMA_VERSION } from "@adam/contracts";
import type {
  ActivityPayload,
  DaemonEvent,
  DaemonEventEnvelope,
  EventActor,
  EventSource,
  SessionStartedPayload
} from "./types.js";

export class EventLogWriter {
  private sequence: number;

  constructor(
    private readonly logFilePath: string,
    private readonly source: EventSource,
    private readonly actor: EventActor
  ) {
    this.sequence = this.computeStartingSequence();
  }

  private computeStartingSequence(): number {
    if (!existsSync(this.logFilePath)) {
      return 1;
    }
    const content = readFileSync(this.logFilePath, "utf8");
    if (!content.trim()) {
      return 1;
    }
    return content.split(/\r?\n/).filter((line) => line.length > 0).length + 1;
  }

  emitSessionStartedEvent(sessionId: string, payload: SessionStartedPayload): DaemonEvent {
    const event: DaemonEventEnvelope<"session_started", SessionStartedPayload> = {
      id: randomUUID(),
      schemaVersion: SCHEMA_VERSION,
      type: "session_started",
      sessionId,
      sequence: this.sequence++,
      createdAt: new Date().toISOString(),
      source: this.source,
      actor: this.actor,
      payload,
      visibility: "user_visible",
      retention: {
        class: "standard",
        ttlDays: 30
      }
    };
    this.write(event);
    return event;
  }

  emitActivityEvent(sessionId: string, payload: ActivityPayload): DaemonEvent {
    const event: DaemonEventEnvelope<"activity", ActivityPayload> = {
      id: randomUUID(),
      schemaVersion: SCHEMA_VERSION,
      type: "activity",
      sessionId,
      sequence: this.sequence++,
      createdAt: new Date().toISOString(),
      source: this.source,
      actor: this.actor,
      payload,
      visibility: "user_visible",
      retention: {
        class: "standard",
        ttlDays: 30
      }
    };
    this.write(event);
    return event;
  }

  private write(event: DaemonEvent): void {
    appendFileSync(this.logFilePath, `${JSON.stringify(event)}\n`, "utf8");
  }
}

export function resolveEventLogPath(stateDirectory: string, logFileName: string): string {
  mkdirSync(stateDirectory, { recursive: true });
  return path.join(stateDirectory, logFileName);
}
