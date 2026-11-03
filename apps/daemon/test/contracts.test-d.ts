import { describe, expectTypeOf, it } from "vitest";
import type { AdamEventType } from "@adam/contracts";
import type {
  ActivityPayload,
  DaemonEventEnvelope,
  DaemonEventType,
  SessionStartedPayload
} from "../src/types.js";

describe("shared contracts", () => {
  it("uses the shared event type union in the daemon", () => {
    // Vitest typechecking enforces structural equality: the daemon union must
    // have exactly the same members as the shared union, so widening or
    // narrowing either one fails here.
    expectTypeOf<DaemonEventType>().toEqualTypeOf<AdamEventType>();
  });

  it("binds one shared event type to each daemon event envelope", () => {
    expectTypeOf<
      DaemonEventEnvelope<"session_started", SessionStartedPayload>["type"]
    >().toEqualTypeOf<"session_started">();
    expectTypeOf<DaemonEventEnvelope<"activity", ActivityPayload>["type"]>().toEqualTypeOf<"activity">();
  });
});
