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
    // `AdamEventType` is a type, not a runtime value, so the identity of the
    // two unions is asserted at the type level. Vitest typechecking enforces
    // this assertion: the daemon union has to be the shared union, not a
    // hand-written copy of it.
    expectTypeOf<DaemonEventType>().toEqualTypeOf<AdamEventType>();
  });

  it("binds one shared event type to each daemon event envelope", () => {
    expectTypeOf<
      DaemonEventEnvelope<"session_started", SessionStartedPayload>["type"]
    >().toEqualTypeOf<"session_started">();
    expectTypeOf<DaemonEventEnvelope<"activity", ActivityPayload>["type"]>().toEqualTypeOf<"activity">();
  });
});
