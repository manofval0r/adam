import { describe, expect, it } from "vitest";
import { EventEnvelopeSchema, parseEventEnvelope } from "../src/events.js";

const validEnvelope = {
  id: "evt_01",
  schemaVersion: "2026-07-26",
  type: "activity",
  sessionId: "ses_01",
  sequence: 12,
  createdAt: "2026-10-24T12:00:00.000Z",
  source: { kind: "desktop_daemon", id: "d_01", name: "studio", version: "0.1.0" },
  actor: { kind: "system", id: "a_01", displayName: "Codex" },
  payload: { title: "running tests" },
  visibility: "user_visible",
  retention: { class: "standard" },
};

describe("EventEnvelopeSchema", () => {
  it("accepts a well formed envelope", () => {
    expect(parseEventEnvelope(validEnvelope)).toMatchObject({ id: "evt_01", sequence: 12 });
  });

  it("rejects an unknown event type", () => {
    expect(() => parseEventEnvelope({ ...validEnvelope, type: "not_a_real_type" })).toThrow(
      /unknown event type/i,
    );
  });

  it("rejects a schema version it does not know", () => {
    expect(() => parseEventEnvelope({ ...validEnvelope, schemaVersion: "1999-01-01" })).toThrow();
  });

  it("rejects unknown top level keys", () => {
    expect(() => parseEventEnvelope({ ...validEnvelope, extra: true })).toThrow(/unrecognized/i);
  });

  it("rejects a payload that is not an object", () => {
    expect(() => parseEventEnvelope({ ...validEnvelope, payload: "text" })).toThrow();
  });

  it("accepts a payload containing user text that resembles a field name", () => {
    const envelope = {
      ...validEnvelope,
      payload: { title: "sequence: 999", body: "type: activity" },
    };
    expect(parseEventEnvelope(envelope).payload).toMatchObject({ title: "sequence: 999" });
  });

  it("rejects an unknown source kind", () => {
    expect(() => parseEventEnvelope({ ...validEnvelope, source: { kind: "toaster" } })).toThrow();
  });

  it("accepts a retention class without a ttl", () => {
    expect(parseEventEnvelope(validEnvelope).retention).toEqual({ class: "standard" });
  });

  it("rejects an unknown key inside a nested object", () => {
    expect(() => parseEventEnvelope({ ...validEnvelope, source: { kind: "desktop_daemon", surprise: true } })).toThrow(
      /unrecognized/i,
    );
  });

  it("rejects an unknown key inside a nested actor object", () => {
    expect(() => parseEventEnvelope({ ...validEnvelope, actor: { kind: "system", surprise: true } })).toThrow(
      /unrecognized/i,
    );
  });

  it("accepts a zero offset utc timestamp", () => {
    expect(parseEventEnvelope({ ...validEnvelope, createdAt: "2026-10-24T12:00:00+00:00" }).createdAt).toBe(
      "2026-10-24T12:00:00+00:00",
    );
  });

  it("rejects a timestamp with a non-zero offset", () => {
    expect(() => parseEventEnvelope({ ...validEnvelope, createdAt: "2026-10-24T12:00:00+01:00" })).toThrow();
  });

  it("rejects a ttl of zero days", () => {
    expect(() => parseEventEnvelope({ ...validEnvelope, retention: { class: "standard", ttlDays: 0 } })).toThrow();
  });
});
