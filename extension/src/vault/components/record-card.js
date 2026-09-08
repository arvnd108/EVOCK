/**
 * EVOCK — one vault list row (Role C, step 03 / C3).
 *
 * Renders a single `list()` projection item: evidence id, platform label,
 * contact label, verification pill. Metadata only — this module never touches a
 * screenshot, ciphertext or `vaultRepo`.
 *
 * `item.contact_label` is supplied by Role B's `projectListItem`; this still
 * falls back to "unknown account" when it is absent or null, per Role C.md §C3.
 *
 * This module also owns the small locale-independent date/time formatters shared
 * across the vault components.
 */

const STALE_AFTER_DAYS = 7;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Format an ISO date (or datetime) as "14 Aug 2026". Parsed from the string's
 * own Y-M-D fields, never `toLocaleDateString`, so it is locale-independent and
 * deterministic across machines.
 * @param {string} iso
 * @returns {string}
 */
export function formatDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "Unknown date";
  const [, y, mo, d] = m;
  return `${Number(d)} ${MONTHS[Number(mo) - 1] ?? "?"} ${y}`;
}

/**
 * "2026-09-01T23:31:14+05:30" -> "1 Sep 2026, 23:31:14 +05:30".
 * Parsed from the string's own fields — locale-independent, no `Date`.
 * @param {string} iso
 * @returns {string}
 */
export function formatDeviceTime(iso) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?/.exec(
    String(iso || "")
  );
  if (!m) return String(iso || "unknown");
  const [, date, time, offsetRaw] = m;
  const offset = !offsetRaw || offsetRaw === "Z" ? offsetRaw || "" : ` ${offsetRaw}`;
  return `${formatDay(date)}, ${time}${offset ? offset : ""}`.trim();
}

/**
 * Decide the verification pill for a row.
 *
 * @param {import("../../shared/types.js").VerificationResult|null} lastVerification
 * @param {{ now?: number, staleAfterDays?: number }} [opts]
 * @returns {{ label: string, symbol: string, className: string, state: string }}
 */
export function verificationPill(
  lastVerification,
  { now = Date.now(), staleAfterDays = STALE_AFTER_DAYS } = {}
) {
  if (!lastVerification) {
    return {
      state: "never",
      symbol: "—",
      label: "Never verified",
      className: "nk-pill nk-pill--never"
    };
  }

  const { status, verified_at } = lastVerification;
  const when = verified_at ? formatDay(verified_at) : null;

  if (status === "MODIFIED") {
    return {
      state: "modified",
      symbol: "❌",
      label: when ? `Modified — checked ${when}` : "Modified",
      className: "nk-pill nk-pill--modified"
    };
  }

  if (status === "ERROR") {
    return {
      state: "error",
      symbol: "⚠",
      label: when ? `Could not verify ${when}` : "Could not verify",
      className: "nk-pill nk-pill--error"
    };
  }

  // status === "VERIFIED"
  const ageMs = verified_at ? now - Date.parse(verified_at) : Infinity;
  const isStale = !Number.isFinite(ageMs) || ageMs > staleAfterDays * 86_400_000;
  if (isStale) {
    return {
      state: "stale",
      symbol: "⚠",
      label: when ? `Not verified since ${when}` : "Not verified recently",
      className: "nk-pill nk-pill--stale"
    };
  }
  return {
    state: "verified",
    symbol: "✓",
    label: when ? `Verified ${when}` : "Verified",
    className: "nk-pill nk-pill--verified"
  };
}

/**
 * @param {object} item a `list()` projection item.
 * @param {{ onSelect?: (evidenceId: string) => void, now?: number }} [opts]
 * @returns {HTMLButtonElement}
 */
export function renderRecordCard(item, { onSelect, now } = {}) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "nk-record";
  row.dataset.evidenceId = item.evidence_id;

  const id = document.createElement("span");
  id.className = "nk-record__id";
  id.textContent = item.evidence_id;

  const platform = document.createElement("span");
  platform.className = "nk-record__platform";
  platform.textContent = item.platform_label || "Unknown";

  const contactName = item.contact_label ?? null;
  const contact = document.createElement("span");
  contact.className = contactName
    ? "nk-record__contact"
    : "nk-record__contact nk-record__contact--empty";
  contact.textContent = contactName || "unknown account";

  const pillInfo = verificationPill(item.last_verification ?? null, { now });
  const pill = document.createElement("span");
  pill.className = `${pillInfo.className} nk-record__pill`;
  pill.textContent = `${pillInfo.symbol} ${pillInfo.label}`;
  pill.dataset.state = pillInfo.state;

  row.append(id, platform, contact, pill);

  row.addEventListener("click", () => {
    onSelect?.(item.evidence_id);
    row.dispatchEvent(
      new CustomEvent("vault:select", {
        bubbles: true,
        detail: { evidence_id: item.evidence_id }
      })
    );
  });

  return row;
}
