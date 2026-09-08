/**
 * EVOCK — deterministic vault-list fixture generator (Role C, step 01 / C2).
 *
 * Produces items in the exact shape `vaultRepo.list()` returns — see
 * `projectListItem` in `extension/src/storage/vault-repo.js`: metadata only,
 * never a screenshot or ciphertext. `tests/fixtures/vault.50.sample.json` is the
 * committed output of `makeVaultList(50)`; `ui-fixtures.test.js` asserts the two
 * stay in sync.
 *
 * Fully deterministic — no `Date.now()`, no `Math.random()` — so timeline,
 * grouping, filter and sort tests reproduce byte-for-byte on every machine.
 *
 * NOTE (coordination, step 03): `projectListItem` does NOT expose the AI-derived
 * contact name, yet the timeline row in Role C.md §C3 shows a contact column.
 * That is a Role B contract gap, tracked in docs/role-c-status.md — this
 * generator deliberately mirrors the real projection and adds no `contact_label`.
 */

const PLATFORMS = ["WhatsApp", "Instagram", "Website", "Unknown"];
const DOMAINS = {
  WhatsApp: "web.whatsapp.com",
  Instagram: "www.instagram.com",
  Website: "example.com",
  Unknown: "forum.example"
};

function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Capture instant for item `i`. Five items per calendar day, 20 days per month
 * starting 2026-08-01, so `makeVaultList(50)` spans exactly 10 distinct days
 * (2026-08-01 .. 2026-08-10) and larger `n` rolls cleanly into later months.
 */
function createdAt(i) {
  const dayIndex = Math.floor(i / 5);
  const month = 8 + Math.floor(dayIndex / 20);
  const dom = 1 + (dayIndex % 20);
  const hour = 9 + (i % 5) * 2; // 09, 11, 13, 15, 17
  const minute = (i * 7) % 60;
  return `2026-${pad2(month)}-${pad2(dom)}T${pad2(hour)}:${pad2(minute)}:00+05:30`;
}

function verified(verified_at) {
  return {
    screenshot_hash_ok: true,
    metadata_hash_ok: true,
    manifest_hash_ok: true,
    signature_ok: true,
    status: "VERIFIED",
    details: [],
    verified_at
  };
}

function modified(verified_at) {
  return {
    screenshot_hash_ok: true,
    metadata_hash_ok: false,
    manifest_hash_ok: false,
    signature_ok: true,
    status: "MODIFIED",
    details: ["metadata hash mismatch", "manifest hash mismatch"],
    verified_at
  };
}

/** Cycle through: never verified · stale · modified · recently verified (x2). */
function lastVerification(i) {
  switch (i % 5) {
    case 0:
      return null;
    case 1:
      // Only ever checked on the capture day — reads as "not verified since …".
      return verified(createdAt(i).replace(/T.*/, "T20:00:00+05:30"));
    case 2:
      return modified("2026-09-06T18:30:00+05:30");
    case 3:
      return verified("2026-09-07T09:15:00+05:30");
    default:
      return verified("2026-09-08T08:45:00+05:30");
  }
}

/**
 * @param {number} [n] how many list items to produce (default 50).
 * @returns {Array<object>} items shaped like `vaultRepo.list()` output, ordered
 *   newest-first to match `list()`'s default `sort: "newest"`.
 */
export function makeVaultList(n = 50) {
  const items = [];
  for (let i = 0; i < n; i++) {
    const platform_label = PLATFORMS[i % PLATFORMS.length];
    const domain = DOMAINS[platform_label];
    const device_captured_at = createdAt(i);
    const mobile = i % 3 === 0;
    items.push({
      evidence_id: `NK-${String(i + 1).padStart(4, "0")}`,
      created_at: device_captured_at,
      platform_label,
      source: {
        capture_method: "browser_extension.captureVisibleTab",
        url: `https://${domain}/thread/${i + 1}`,
        domain,
        tab_title: platform_label === "Unknown" ? "Conversation" : platform_label
      },
      capture: {
        device_captured_at,
        screenshot_width: mobile ? 390 : 1440,
        screenshot_height: mobile ? 844 : 900,
        mime_type: "image/png"
      },
      extraction_status: i % 7 === 6 ? "failed" : "ok",
      last_verification: lastVerification(i)
    });
  }
  // list() yields newest-first; the generator builds oldest-first, so flip it.
  return items.reverse();
}
