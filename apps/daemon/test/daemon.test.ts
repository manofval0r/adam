import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runDaemonOnce } from "../src/daemon.js";

describe("daemon run", () => {
  it("emits milestone one events into local log", () => {
    const stateRoot = mkdtempSync(path.join(os.tmpdir(), "adam-daemon-state-"));
    const previous = process.env.ADAM_STATE_DIR;
    process.env.ADAM_STATE_DIR = stateRoot;

    try {
      const result = runDaemonOnce(stateRoot);
      expect(result.emittedEvents).toBe(3);

      const rows = readFileSync(result.logPath, "utf8")
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line));

      expect(rows).toHaveLength(3);
      expect(rows[0].type).toBe("session_started");
      expect(rows[1].type).toBe("activity");
      expect(rows[2].type).toBe("activity");
    } finally {
      if (previous === undefined) {
        delete process.env.ADAM_STATE_DIR;
      } else {
        process.env.ADAM_STATE_DIR = previous;
      }
    }
  });
});
