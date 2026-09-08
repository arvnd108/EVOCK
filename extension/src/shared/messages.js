/**
 * EVOCK - Cross-context message protocol
 *
 * The single source of truth for every message that crosses a context
 * boundary (popup / vault  <->  service worker), per Plan/Building Plan.md §5.6.
 *
 * Every message is a { type, payload } envelope. `type` is always one of the
 * MSG values below - never a bare string literal at the call site.
 */

/**
 * Message types exchanged over chrome.runtime.sendMessage.
 * @readonly
 * @enum {string}
 */
export const MSG = Object.freeze({
  /** popup -> worker: run the full preservation pipeline. payload: {} -> { evidence_id } */
  PRESERVE_START: "PRESERVE_START",
  /** worker -> popup: streamed pipeline progress. payload: { stage, ok, error } */
  PRESERVE_PROGRESS: "PRESERVE_PROGRESS",
  /** vault -> worker: list stored records without ciphertext. -> StoredEvidenceRecord[] */
  LIST_EVIDENCE: "LIST_EVIDENCE",
  /**
   * vault -> worker: one record + decrypted screenshot data URL + versions[].
   * payload: { evidence_id, for_export? }. With `for_export: true` the response
   * also carries `screenshot_ciphertext` / `iv` as base64 for the ZIP export
   * (Role C step 07); the AES-GCM key is never included.
   */
  GET_EVIDENCE: "GET_EVIDENCE",
  /** vault -> worker: recompute hashes + check signature. payload: { evidence_id } -> VerificationResult */
  VERIFY_EVIDENCE: "VERIFY_EVIDENCE",
  /**
   * vault -> worker: record a human-corrected version of the AI metadata.
   * payload: { evidence_id, data, note } -> { ok, record }.
   * Role B's evidence core re-canonicalizes / re-hashes / re-signs and appends a
   * new entry to `versions[]` — Role C never signs. (Role C step 06; worker route
   * + `reviseMetadata` are a Role B/A follow-up, see Role B Prompts/12.)
   */
  REVISE_METADATA: "REVISE_METADATA",
  /** vault -> worker: dev-build-only tamper harness. payload: { evidence_id, mode } -> { ok } */
  TAMPER_DEMO: "TAMPER_DEMO"
  //
  // Retired (Role A Prompts/13, Task B): EXPORT_PDF / EXPORT_PACKAGE.
  // Export generation runs on the vault page (Role C
  // vault/components/export-controller.js), not in the worker: jsPDF / JSZip
  // load as classic <script> on an extension page with no bundler, a Blob +
  // chrome.downloads.download works fine from a page, and it avoids MV3
  // worker-lifetime limits during a multi-hundred-KB build. The page asks the
  // worker only for data — GET_EVIDENCE { for_export: true }. If a worker-side
  // route is ever wanted, re-add the constants and the handler shape in
  // Role A Prompts/13 Task B.
});

/**
 * PRESERVE_PROGRESS stages, in true pipeline order. The popup renders these as a
 * live checklist and it is also the primary debugging surface.
 *
 * Order note (Role B deviation B, reconciled): encryption runs BEFORE signing.
 * The AES-GCM IV lives inside the manifest (visual_artifact.encryption.iv), so it
 * has to exist before the manifest is built, hashed and signed. The sequence the
 * evidence core actually emits is hash → encrypt → sign → timestamp → store.
 * @readonly
 * @type {ReadonlyArray<string>}
 */
export const PRESERVE_STAGES = Object.freeze([
  "capture",
  "extract",
  "hash",
  "encrypt",
  "sign",
  "timestamp",
  "store"
]);

/**
 * Build a { type, payload } envelope.
 * @param {string} type - one of MSG
 * @param {object} [payload]
 * @returns {{ type: string, payload: object }}
 */
export function envelope(type, payload = {}) {
  return { type, payload };
}
