import { mkdirSync, mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectCodexAvailability, discoverLatestCodexSession } from "../src/codex.js";

describe("codex helpers", () => {
  it("returns unavailable when codex binary does not exist", () => {
    const availability = detectCodexAvailability("__missing_codex_binary__");
    expect(availability.available).toBe(false);
    expect(availability.error).toBeTruthy();
  });

  it("finds latest codex session file", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "adam-codex-"));
    const first = path.join(root, "2026", "07", "26");
    const second = path.join(root, "2026", "07", "27");

    const firstFile = path.join(first, "session-a.jsonl");
    const secondFile = path.join(second, "session-b.jsonl");
    mkdirSync(first, { recursive: true });
    mkdirSync(second, { recursive: true });

    writeFileSync(firstFile, "{\"x\":1}\n", { encoding: "utf8", flag: "w" });
    writeFileSync(secondFile, "{\"x\":2}\n", { encoding: "utf8", flag: "w" });

    const firstDate = new Date("2026-07-26T12:00:00.000Z");
    const secondDate = new Date("2026-07-27T12:00:00.000Z");
    utimesSync(firstFile, firstDate, firstDate);
    utimesSync(secondFile, secondDate, secondDate);

    const latest = discoverLatestCodexSession(root);
    expect(latest?.sessionId).toBe("session-b");
    expect(latest?.filePath).toBe(secondFile);
  });
});
