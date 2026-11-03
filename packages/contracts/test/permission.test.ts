import { describe, expect, it } from "vitest";
import {
  ContractValidationError,
  PermissionDecisionSchema,
  PermissionRequestSchema,
  applyDecision,
  parsePermissionDecision,
  parsePermissionRequest,
} from "../src/index.js";
import type { PermissionDecision, PermissionRequest } from "../src/permission.js";

const request: PermissionRequest = {
  requestId: "req_01",
  sessionId: "ses_01",
  subject: "src/app.ts",
  capability: "write_files",
  riskTier: "yellow",
  summary: "Write src/app.ts",
  details: { path: "src/app.ts" },
  requestedAt: "2026-10-24T12:00:00.000Z",
};

const validDecision: PermissionDecision = {
  requestId: "req_01",
  decision: "approved",
  decidedBy: "user:david",
  decidedAt: "2026-10-24T12:05:00.000Z",
  reason: "expected change",
};

/** A valid decision aimed at the given request id. */
function decisionFor(requestId: string): PermissionDecision {
  return { ...validDecision, requestId };
}

describe("parsePermissionRequest", () => {
  it("accepts a well formed request", () => {
    expect(parsePermissionRequest(request)).toMatchObject({
      requestId: "req_01",
      capability: "write_files",
      riskTier: "yellow",
    });
  });

  it("accepts a request without optional details", () => {
    expect(
      parsePermissionRequest({
        requestId: "req_02",
        sessionId: "ses_01",
        subject: "src/app.ts",
        capability: "read_files",
        riskTier: "green",
        summary: "Read src/app.ts",
        requestedAt: "2026-10-24T12:00:00.000Z",
      }),
    ).toMatchObject({ requestId: "req_02" });
  });

  it("rejects an empty requestId", () => {
    expect(() => parsePermissionRequest({ ...request, requestId: "" })).toThrow(/requestId/);
  });

  it("rejects an empty sessionId", () => {
    expect(() => parsePermissionRequest({ ...request, sessionId: "" })).toThrow(/sessionId/);
  });

  it("rejects a request with an empty subject", () => {
    expect(() => parsePermissionRequest({ ...request, subject: "" })).toThrow(/subject/);
  });

  it("rejects an empty capability", () => {
    expect(() => parsePermissionRequest({ ...request, capability: "" })).toThrow(/capability/);
  });

  it("rejects an empty summary", () => {
    expect(() => parsePermissionRequest({ ...request, summary: "" })).toThrow(/summary/);
  });

  it("rejects an unknown risk tier", () => {
    expect(() => parsePermissionRequest({ ...request, riskTier: "critical" })).toThrow(/riskTier/);
  });

  it("rejects unknown top level keys", () => {
    expect(() => parsePermissionRequest({ ...request, extra: true })).toThrow(/unrecognized/i);
  });

  it("rejects details that is not a record", () => {
    expect(() => parsePermissionRequest({ ...request, details: "src/app.ts" })).toThrow(/details/);
  });

  it.each(["approved", "denied"] as const)("accepts a fully %s request without a reason", (decision) => {
    const { reason: _reason, ...withoutReason } = validDecision;
    const parsed = parsePermissionRequest({ ...request, ...withoutReason, decision });
    expect(parsed).toMatchObject({ ...withoutReason, decision });
    expect(parsed).not.toHaveProperty("reason");
  });

  it("rejects a request that claims a decision without naming a decider", () => {
    expect(() => parsePermissionRequest({ ...request, decision: "approved" })).toThrow();
  });

  it("rejects a request that names a decider without a decision", () => {
    expect(() => parsePermissionRequest({ ...request, decidedBy: "user:david" })).toThrow();
  });

  it("rejects a reason without a decision", () => {
    expect(() => parsePermissionRequest({ ...request, reason: "already approved" })).toThrow(/reason/);
  });

  it("reports every failing field in the error issues", () => {
    let issues: string[] = [];
    let message = "";
    try {
      parsePermissionRequest({ ...request, requestId: "", summary: "" });
    } catch (error) {
      expect(error).toBeInstanceOf(ContractValidationError);
      issues = (error as ContractValidationError).issues;
      message = (error as ContractValidationError).message;
    }

    expect(issues).toHaveLength(2);
    expect(message).toMatch(/^Invalid permission request:/);
    expect(message).toMatch(/requestId/);
    expect(message).toMatch(/summary/);
  });
});

describe("parsePermissionDecision", () => {
  it("accepts a well formed decision", () => {
    expect(parsePermissionDecision(validDecision)).toMatchObject({
      requestId: "req_01",
      decision: "approved",
      decidedBy: "user:david",
    });
  });

  it("accepts a decision without an optional reason", () => {
    const { reason: _reason, ...withoutReason } = validDecision;
    expect(parsePermissionDecision(withoutReason)).toMatchObject({ requestId: "req_01" });
  });

  it("rejects a decision whose requestId is empty", () => {
    expect(() => parsePermissionDecision({ ...validDecision, requestId: "" })).toThrow(/requestId/);
  });

  it("rejects an empty decidedBy", () => {
    expect(() => parsePermissionDecision({ ...validDecision, decidedBy: "" })).toThrow(/decidedBy/);
  });

  it("rejects an unknown decision value", () => {
    expect(() => parsePermissionDecision({ ...validDecision, decision: "maybe" })).toThrow(/decision/);
  });

  it("rejects a decision with an empty reason", () => {
    expect(() => parsePermissionDecision({ ...validDecision, reason: "" })).toThrow(/reason/);
  });

  it("rejects unknown keys", () => {
    expect(() => parsePermissionDecision({ ...validDecision, extra: true })).toThrow(/unrecognized/i);
  });

  it("identifies permission decision validation errors from the public parser", () => {
    const parseInvalid = () => parsePermissionDecision({ ...validDecision, requestId: "" });
    expect(parseInvalid).toThrow(ContractValidationError);
    expect(parseInvalid).toThrow(/^Invalid permission decision: requestId:/);
  });
});

describe.each([
  ["permission request requestedAt", "requestedAt", (timestamp: string) =>
    parsePermissionRequest({ ...request, requestedAt: timestamp }).requestedAt],
  ["permission request decidedAt", "decidedAt", (timestamp: string) =>
    parsePermissionRequest({ ...request, ...validDecision, decidedAt: timestamp }).decidedAt],
  ["permission decision decidedAt", "decidedAt", (timestamp: string) =>
    parsePermissionDecision({ ...validDecision, decidedAt: timestamp }).decidedAt],
] as const)("%s UTC timestamps", (_case, field, parseTimestamp) => {
  it.each([
    "2026-10-24T12:00:00+01:00",
    "2026-10-24T12:00:00-00:00",
    "2026-00-24T12:00:00Z",
    "2026-13-24T12:00:00Z",
    "2026-10-00T12:00:00Z",
    "2026-10-32T12:00:00Z",
    "2026-10-24T24:00:00Z",
    "2026-10-24T12:60:00Z",
    "2026-10-24T12:00:60Z",
  ])("rejects an invalid UTC timestamp: %s", (timestamp) => {
    expect(() => parseTimestamp(timestamp)).toThrow(field);
  });

  it.each([
    ["the Z designator", "2026-10-24T12:00:00Z"],
    ["the +00:00 UTC offset", "2026-10-24T12:00:00+00:00"],
    ["a clock far in the past", "1900-01-01T00:00:00Z"],
    ["a clock far in the future", "2999-12-31T23:59:59+00:00"],
    ["a plausible day range without calendar validation", "2026-02-31T12:00:00Z"],
  ])("accepts %s", (_case, timestamp) => {
    expect(parseTimestamp(timestamp)).toBe(timestamp);
  });
});

describe("applyDecision", () => {
  it("rejects a decision for an unknown request", () => {
    expect(() => applyDecision([], decisionFor("req_missing"))).toThrow(/no matching permission request/i);
    expect(() => applyDecision([], decisionFor("req_missing"))).toThrow(ContractValidationError);
  });

  it("rejects a second decision for an already decided request", () => {
    const decided = applyDecision([request], decisionFor("req_01"));
    expect(() => applyDecision(decided, decisionFor("req_01"))).toThrow(/already decided/i);
    expect(() => applyDecision(decided, decisionFor("req_01"))).toThrow(ContractValidationError);
  });

  it("does not let a duplicate requestId slip past the already decided check", () => {
    const duplicate = { ...request, requestId: "req_01" };
    const decided = applyDecision([request, duplicate], decisionFor("req_01"));
    expect(decided[0]).toMatchObject({ decision: "approved" });
    expect(() => applyDecision(decided, decisionFor("req_01"))).toThrow(/already decided/i);
  });

  it("replaces the matching request in one place only when the same instance is listed twice", () => {
    const decided = applyDecision([request, request], decisionFor("req_01"));
    expect(decided[0]).toMatchObject({ requestId: "req_01", decision: "approved" });
    expect(decided[1]).not.toHaveProperty("decision");
  });

  it("records the decision against the matching request", () => {
    const result = applyDecision([request], decisionFor("req_01"));
    expect(result[0]).toMatchObject({ requestId: "req_01", decision: "approved" });
  });

  it("records a denial", () => {
    const result = applyDecision([request], { ...decisionFor("req_01"), decision: "denied" });
    expect(result[0]).toMatchObject({ requestId: "req_01", decision: "denied" });
  });

  it("carries the deciding principal, the time and the reason into the request", () => {
    const result = applyDecision([request], decisionFor("req_01"));
    expect(result[0]).toMatchObject({
      decidedBy: "user:david",
      decidedAt: "2026-10-24T12:05:00.000Z",
      reason: "expected change",
    });
  });

  it("takes the reason from the decision rather than from the request", () => {
    const withStaleReason: PermissionRequest = { ...request, reason: "stale reason" };
    const result = applyDecision([withStaleReason], decisionFor("req_01"));
    expect(result[0]).toMatchObject({ reason: "expected change" });

    const { reason: _reason, ...decisionWithoutReason } = decisionFor("req_01");
    const withoutReason = applyDecision([withStaleReason], decisionWithoutReason);
    expect(withoutReason[0]).not.toHaveProperty("reason");
  });

  it("leaves the requests that did not match untouched", () => {
    const other: PermissionRequest = { ...request, requestId: "req_02" };
    const result = applyDecision([request, other], decisionFor("req_01"));

    expect(result[1]).toBe(other);
    expect(result[1]).not.toHaveProperty("decision");
  });

  it("does not mutate the requests it was given", () => {
    const requests = [request];
    const result = applyDecision(requests, decisionFor("req_01"));

    expect(result).not.toBe(requests);
    expect(result[0]).not.toBe(request);
    expect(request).not.toHaveProperty("decision");
  });

  it("produces a request that still satisfies the request schema", () => {
    const result = applyDecision([request], decisionFor("req_01"));
    expect(PermissionRequestSchema.safeParse(result[0]).success).toBe(true);
  });

  it("produces a decision that satisfies the decision schema", () => {
    expect(PermissionDecisionSchema.safeParse(decisionFor("req_01")).success).toBe(true);
  });
});
