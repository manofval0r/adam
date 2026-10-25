import { z } from "zod";

/** Version of the normalized event envelope described in `docs/event-schema.md`. */
export const SCHEMA_VERSION = "2026-07-26";

const ADAM_EVENT_TYPES = [
  "session_started",
  "message",
  "activity",
  "tool_call",
  "permission_request",
  "permission_decision",
  "decision_request",
  "decision_response",
  "file_change",
  "diff",
  "artifact",
  "git_event",
  "ci_event",
  "prompt_delivery",
  "error",
  "session_ended",
] as const;

const EVENT_SOURCE_KINDS = [
  "desktop_daemon",
  "cloud_relay",
  "web_client",
  "mobile_client",
  "adapter",
  "github",
  "ci",
  "cloud_runner",
] as const;

const EVENT_ACTOR_KINDS = ["user", "assistant", "system", "adapter", "github", "ci"] as const;

const EVENT_VISIBILITIES = ["user_visible", "collapsed", "audit_only", "hidden"] as const;

const EVENT_RETENTION_CLASSES = ["ephemeral", "standard", "audit", "artifact_pointer"] as const;

/**
 * Shape-only check for an ISO 8601 timestamp in UTC.
 *
 * Accepts the `Z` designator and a zero numeric offset (`+00:00`), because both are UTC,
 * and rejects a non-zero offset such as `+01:00`, because that is not a UTC timestamp.
 * Clock accuracy is never checked: a well-formed timestamp from a device with a wrong
 * clock still validates.
 */
export const ISO_8601_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]00:00)$/;

const AdamEventTypeSchema = z.enum(ADAM_EVENT_TYPES, { error: "unknown event type" });
export type AdamEventType = z.infer<typeof AdamEventTypeSchema>;

const EventSourceKindSchema = z.enum(EVENT_SOURCE_KINDS);
export type EventSourceKind = z.infer<typeof EventSourceKindSchema>;

const EventActorKindSchema = z.enum(EVENT_ACTOR_KINDS);
export type EventActorKind = z.infer<typeof EventActorKindSchema>;

const EventVisibilitySchema = z.enum(EVENT_VISIBILITIES);
export type EventVisibility = z.infer<typeof EventVisibilitySchema>;

const EventRetentionClassSchema = z.enum(EVENT_RETENTION_CLASSES);
export type EventRetentionClass = z.infer<typeof EventRetentionClassSchema>;

export const EventSourceSchema = z.strictObject({
  kind: EventSourceKindSchema,
  id: z.string().optional(),
  name: z.string().optional(),
  version: z.string().optional(),
});
export type EventSource = z.infer<typeof EventSourceSchema>;

export const EventActorSchema = z.strictObject({
  kind: EventActorKindSchema,
  id: z.string().optional(),
  displayName: z.string().optional(),
});
export type EventActor = z.infer<typeof EventActorSchema>;

export const EventRetentionSchema = z.strictObject({
  class: EventRetentionClassSchema,
  ttlDays: z.number().int().positive().optional(),
});
export type EventRetention = z.infer<typeof EventRetentionSchema>;

export const EventEnvelopeSchema = z.strictObject({
  id: z.string().min(1),
  schemaVersion: z.literal(SCHEMA_VERSION),
  type: AdamEventTypeSchema,
  sessionId: z.string().min(1),
  sequence: z.number().int().min(0),
  createdAt: z.string().regex(ISO_8601_UTC_PATTERN),
  source: EventSourceSchema,
  actor: EventActorSchema,
  correlationId: z.string().min(1).optional(),
  parentEventId: z.string().min(1).optional(),
  payload: z.record(z.string(), z.unknown()),
  visibility: EventVisibilitySchema,
  retention: EventRetentionSchema,
});
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

/**
 * Error raised when a payload does not satisfy a shared contract schema.
 *
 * `subject` names the contract the payload was checked against. It only affects
 * the message, so a module that validates a different contract can say so instead
 * of borrowing the event envelope wording.
 */
export class ContractValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[], subject = "event envelope") {
    super(`Invalid ${subject}: ${issues.join(", ")}`);
    this.name = "ContractValidationError";
    this.issues = issues;
  }
}

/**
 * Turns a Zod error into the issue list carried by {@link ContractValidationError}.
 *
 * One string per issue. An issue that failed on a field is prefixed with the path
 * of that field; an issue with no path is reported on its own.
 */
export function formatContractIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map((segment) => String(segment)).join(".");
    return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
  });
}

/**
 * Validates an unknown input against the shared event envelope.
 *
 * Throws {@link ContractValidationError} when the input does not satisfy the schema.
 */
export function parseEventEnvelope(input: unknown): EventEnvelope {
  const result = EventEnvelopeSchema.safeParse(input);
  if (result.success) {
    return result.data;
  }

  throw new ContractValidationError(formatContractIssues(result.error));
}
