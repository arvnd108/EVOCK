/**
 * EVOCK — message direction helper (shared/message-direction.js).
 *
 * Direction is derived from the message `type`, never hardcoded. The helper is
 * the single source every UI and export uses, so its behaviour is pinned here.
 */

import { describe, expect, it } from "vitest";
import {
  directionLabel,
  MESSAGE_DIRECTIONS,
  normalizeDirection
} from "../../extension/src/shared/message-direction.js";

describe("normalizeDirection", () => {
  it("passes through the three canonical values", () => {
    expect(normalizeDirection({ type: "incoming" })).toBe("incoming");
    expect(normalizeDirection({ type: "outgoing" })).toBe("outgoing");
    expect(normalizeDirection({ type: "unknown" })).toBe("unknown");
  });

  it("accepts a raw type string as well as a message object", () => {
    expect(normalizeDirection("outgoing")).toBe("outgoing");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(normalizeDirection({ type: "  Incoming " })).toBe("incoming");
    expect(normalizeDirection("OUTGOING")).toBe("outgoing");
  });

  it("collapses missing / null / unrecognised to 'unknown'", () => {
    expect(normalizeDirection(undefined)).toBe("unknown");
    expect(normalizeDirection(null)).toBe("unknown");
    expect(normalizeDirection({})).toBe("unknown");
    expect(normalizeDirection({ type: null })).toBe("unknown");
    expect(normalizeDirection({ type: "sent" })).toBe("unknown");
  });
});

describe("directionLabel", () => {
  it("returns the capitalised label for each direction", () => {
    expect(directionLabel({ type: "incoming" })).toBe("Incoming");
    expect(directionLabel({ type: "outgoing" })).toBe("Outgoing");
    expect(directionLabel({ type: "unknown" })).toBe("Unknown");
  });

  it("always returns a non-empty label so every representation shows a direction", () => {
    for (const m of [undefined, null, {}, { type: "" }, { type: "??" }]) {
      expect(directionLabel(m)).toBe("Unknown");
    }
  });
});

describe("MESSAGE_DIRECTIONS", () => {
  it("is the frozen incoming/outgoing/unknown triple", () => {
    expect(MESSAGE_DIRECTIONS).toEqual(["incoming", "outgoing", "unknown"]);
    expect(Object.isFrozen(MESSAGE_DIRECTIONS)).toBe(true);
  });
});
