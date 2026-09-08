/**
 * EVOCK — UI-side fixture loader (Role C, step 01 / C2).
 *
 * Role C builds the entire vault, verification and export UI against
 * `tests/fixtures/` before a real record exists. This helper mirrors Role B's
 * `tests/helpers/fixtures.js` for the presentation slice:
 *
 *  - `loadUiFixture(name)`  — fresh parse of a fixture on every call.
 *  - `decodeRecord(fixture)` — turns the base64 `screenshot_ciphertext` / `iv`
 *    of a StoredEvidenceRecord fixture into `ArrayBuffer`, so component tests
 *    exercise the real decrypt/render path against a stubbed `vaultRepo`.
 *  - `SCREENSHOT_PNG_DATA_URL` — a small real PNG data URL for <img> rendering.
 */

import { loadFixture } from "./fixtures.js";

/**
 * Load a fixture by name, with or without the `.json` suffix. Returns a freshly
 * parsed object every call, so a test may mutate its copy freely.
 *
 * @param {string} name e.g. "verification.modified.sample" or "record.sample.json"
 * @returns {any}
 */
export function loadUiFixture(name) {
  return loadFixture(name);
}

/**
 * @param {string} b64
 * @returns {ArrayBuffer}
 */
function base64ToArrayBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Copy a StoredEvidenceRecord fixture with `screenshot_ciphertext` and `iv`
 * decoded from base64 text to `ArrayBuffer` (the shape a real IndexedDB record
 * holds). The `_note` documentation key is dropped. The input is not mutated.
 *
 * @param {object} fixture a parsed record.*.sample.json
 * @returns {object}
 */
export function decodeRecord(fixture) {
  const record = structuredClone(fixture);
  delete record._note;
  if (typeof record.screenshot_ciphertext === "string") {
    record.screenshot_ciphertext = base64ToArrayBuffer(record.screenshot_ciphertext);
  }
  if (typeof record.iv === "string") {
    record.iv = base64ToArrayBuffer(record.iv);
  }
  return record;
}

/**
 * Raw PNG data URL carried by capture.sample.json (a 1x1 image). Use it for
 * detail-view <img> rendering tests without wiring up decryption.
 * @type {string}
 */
export const SCREENSHOT_PNG_DATA_URL = loadFixture("capture.sample").screenshotDataUrl;
