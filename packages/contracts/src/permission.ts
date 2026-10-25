import { z } from "zod";
import { ContractValidationError, ISO_8601_UTC_PATTERN } from "./events.js";

const RISK_TIERS = ["green", "yellow", "red"] as const;

const PERMISSION_DECISION_VALUES = ["approved", "denied"] as const;

/** How risky the action a permission request covers is. */
const RiskTierSchema = z.enum(RISK_TIERS);
export type RiskTier = z.infer<typeof RiskTierSchema>;

/** The outcome a permission decision records. */
const PermissionDecisionValueSchema = z.enum(PERMISSION_DECISION_VALUES);
export type PermissionDecisionValue = z.infer<typeof PermissionDecisionValueSchema>;

/**
 * A request for the user's consent to one action.
 *
 * A request that has already been decided carries the decision inline, so a
 * decided request still validates against this schema.
 */
export const PermissionRequestSchema = z.strictObject({
  requestId: z.string().min(1),
  sessionId: z.string().min(1),
  subject: z.string().min(1),
  capability: z.string().min(1),
  riskTier: RiskTierSchema,
  summary: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
  requestedAt: z.string().regex(ISO_8601_UTC_PATTERN),
  decision: PermissionDecisionValueSchema.optional(),
  decidedBy: z.string().min(1).optional(),
  decidedAt: z.string().regex(ISO_8601_UTC_PATTERN).optional(),
  reason: z.string().optional(),
});
export type PermissionRequest = z.infer<typeof PermissionRequestSchema>;

/** A decision on one permission request, recorded by the deciding principal. */
export const PermissionDecisionSchema = z.strictObject({
  requestId: z.string().min(1),
  decision: PermissionDecisionValueSchema,
  decidedBy: z.string().min(1),
  decidedAt: z.string().regex(ISO_8601_UTC_PATTERN),
  reason: z.string().optional(),
});
export type PermissionDecision = z.infer<typeof PermissionDecisionSchema>;

/**
 * Validates an unknown input against the shared permission request schema.
 *
 * Throws {@link ContractValidationError} when the input does not satisfy the schema.
 */
export function parsePermissionRequest(input: unknown): PermissionRequest {
  const result = PermissionRequestSchema.safeParse(input);
  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues.map((issue) => {
    const path = issue.path.map((segment) => String(segment)).join(".");
    return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
  });

  throw new ContractValidationError(issues, "permission request");
}

/**
 * Validates an unknown input against the shared permission decision schema.
 *
 * Throws {@link ContractValidationError} when the input does not satisfy the schema.
 */
export function parsePermissionDecision(input: unknown): PermissionDecision {
  const result = PermissionDecisionSchema.safeParse(input);
  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues.map((issue) => {
    const path = issue.path.map((segment) => String(segment)).join(".");
    return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
  });

  throw new ContractValidationError(issues, "permission decision");
}

/**
 * Applies a decision to the request it belongs to.
 *
 * The matching request is replaced by one that carries the decision inline. The
 * requests given are never mutated.
 *
 * Throws {@link ContractValidationError} when no request matches the decision's
 * `requestId`, or when the matching request already carries a decision.
 */
export function applyDecision(
  requests: PermissionRequest[],
  decision: PermissionDecision,
): PermissionRequest[] {
  const target = requests.find((request) => request.requestId === decision.requestId);

  if (target === undefined) {
    throw new ContractValidationError(
      [`no matching permission request for requestId ${decision.requestId}`],
      "permission decision",
    );
  }

  if (target.decision !== undefined) {
    throw new ContractValidationError(
      [`permission request ${decision.requestId} is already decided`],
      "permission decision",
    );
  }

  const { reason: _requestReason, ...requestFields } = target;
  const decided: PermissionRequest = {
    ...requestFields,
    decision: decision.decision,
    decidedBy: decision.decidedBy,
    decidedAt: decision.decidedAt,
    ...(decision.reason === undefined ? {} : { reason: decision.reason }),
  };

  return requests.map((request) => (request === target ? decided : request));
}
