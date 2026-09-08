/**
 * EVOCK — message direction (Incoming / Outgoing) presentation helper.
 *
 * Direction is NOT a new field. Every extracted message already carries a `type`
 * assigned by the extraction schema — "incoming" | "outgoing" | "unknown". This
 * module is the single place that turns that value into the label rendered
 * beside a message name, so the popup, the vault, the review editor and every
 * export format stay in step and nothing hardcodes a direction.
 *
 *   directionLabel({ type: "incoming" })  -> "Incoming"
 *   directionLabel("outgoing")            -> "Outgoing"
 *   directionLabel({})                    -> "Unknown"   (missing / unrecognised)
 */

/** The canonical `type` values, in display order. */
export const MESSAGE_DIRECTIONS = Object.freeze(["incoming", "outgoing", "unknown"]);

const LABELS = Object.freeze({
  incoming: "Incoming",
  outgoing: "Outgoing",
  unknown: "Unknown"
});

/**
 * Normalise a message (or a raw `type` string) to one of MESSAGE_DIRECTIONS.
 * Anything missing or unrecognised collapses to "unknown".
 *
 * @param {import("./types.js").ExtractedMessage | string | null | undefined} message
 * @returns {"incoming" | "outgoing" | "unknown"}
 */
export function normalizeDirection(message) {
  const raw = typeof message === "string" ? message : message?.type;
  const t = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return LABELS[t] ? t : "unknown";
}

/**
 * The human-readable direction label for a message: "Incoming", "Outgoing" or
 * "Unknown". Always returns a non-empty string so every representation can show
 * a direction beside the name.
 *
 * @param {import("./types.js").ExtractedMessage | string | null | undefined} message
 * @returns {"Incoming" | "Outgoing" | "Unknown"}
 */
export function directionLabel(message) {
  return LABELS[normalizeDirection(message)];
}
