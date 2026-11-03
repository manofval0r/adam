import { describe, expectTypeOf, it } from "vitest";
import type { EventEnvelope } from "@adam/contracts";
import type { RelayStore } from "../src/store.js";
import type {
  RelayActivityEventPayload,
  RelayErrorEventPayload,
  RelayEvent,
  RelayEventInput,
  RelayEventType,
  RelayMessageEventPayload,
  RelayPromptDeliveryPayload,
} from "../src/types.js";

declare const metadata: Omit<EventEnvelope, "type" | "payload"> & { userId: string };
declare const messagePayload: RelayMessageEventPayload;
declare const activityPayload: RelayActivityEventPayload;
declare const promptDeliveryPayload: RelayPromptDeliveryPayload;
declare const errorPayload: RelayErrorEventPayload;
declare const correlatedInput: RelayEventInput;
declare const independentType: RelayEventType;
declare const independentPayload: RelayEvent["payload"];
// Check the actual private construction boundary without making it public.
declare const appendEvent: RelayStore["appendEvent"];

describe("relay event contracts", () => {
  it("pairs each relay event type with its own payload", () => {
    expectTypeOf<Extract<RelayEvent, { type: "message" }>["payload"]>().toEqualTypeOf<RelayMessageEventPayload>();
    expectTypeOf<Extract<RelayEvent, { type: "activity" }>["payload"]>().toEqualTypeOf<RelayActivityEventPayload>();
    expectTypeOf<Extract<RelayEvent, { type: "prompt_delivery" }>["payload"]>().toEqualTypeOf<RelayPromptDeliveryPayload>();
    expectTypeOf<Extract<RelayEvent, { type: "error" }>["payload"]>().toEqualTypeOf<RelayErrorEventPayload>();
  });

  it("retains the shared metadata and internal user scope", () => {
    expectTypeOf<Omit<RelayEvent, "type" | "payload" | "userId">>()
      .toEqualTypeOf<Omit<EventEnvelope, "type" | "payload">>();
    expectTypeOf<RelayEvent["userId"]>().toEqualTypeOf<string>();
  });

  it("accepts each valid pair and a correlated union at the construction boundary", () => {
    appendEvent("user-id", "session-id", { type: "message", payload: messagePayload });
    appendEvent("user-id", "session-id", { type: "activity", payload: activityPayload });
    appendEvent("user-id", "session-id", { type: "prompt_delivery", payload: promptDeliveryPayload });
    appendEvent("user-id", "session-id", { type: "error", payload: errorPayload });
    appendEvent("user-id", "session-id", correlatedInput, "correlation-id");
    expectTypeOf({ ...metadata, ...correlatedInput }).toMatchTypeOf<RelayEvent>();
  });

  it("rejects mismatched payloads in RelayEvent", () => {
    const events: RelayEvent[] = [];
    // @ts-expect-error Message events cannot carry an activity payload.
    events.push({ ...metadata, type: "message", payload: activityPayload });
    // @ts-expect-error Activity events cannot carry a message payload.
    events.push({ ...metadata, type: "activity", payload: messagePayload });
    // @ts-expect-error Delivery events cannot carry an error payload.
    events.push({ ...metadata, type: "prompt_delivery", payload: errorPayload });
    // @ts-expect-error Error events cannot carry a delivery payload.
    events.push({ ...metadata, type: "error", payload: promptDeliveryPayload });
  });

  it("rejects mismatched payloads at appendEvent", () => {
    // @ts-expect-error Message events cannot carry an activity payload.
    appendEvent("user-id", "session-id", { type: "message", payload: activityPayload });
    // @ts-expect-error Activity events cannot carry a message payload.
    appendEvent("user-id", "session-id", { type: "activity", payload: messagePayload });
    // @ts-expect-error Delivery events cannot carry an error payload.
    appendEvent("user-id", "session-id", { type: "prompt_delivery", payload: errorPayload });
    // @ts-expect-error Error events cannot carry a delivery payload.
    appendEvent("user-id", "session-id", { type: "error", payload: promptDeliveryPayload });
  });

  it("rejects independently union-valued types and payloads at both boundaries", () => {
    const events: RelayEvent[] = [];
    // @ts-expect-error Independent unions do not establish a type/payload pairing.
    events.push({ ...metadata, type: independentType, payload: independentPayload });
    // @ts-expect-error A union-valued type must stay correlated with its payload.
    appendEvent("user-id", "session-id", { type: independentType, payload: independentPayload });
  });
});
