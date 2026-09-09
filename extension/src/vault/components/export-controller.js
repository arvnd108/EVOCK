/**
 * EVOCK — export menu + download glue (Role C, step 07 / C6).
 *
 * Sits under the detail panel. "Export ▾" opens it; it offers the two plain
 * outputs and drives them to disk through `chrome.downloads`:
 *
 *   • Human-readable report (PDF)  — pdf-report.js
 *   • Evidence package (ZIP)       — package-zip.js
 *
 * Both are built ON THIS PAGE (not in the service worker): a Blob +
 * `chrome.downloads.download` works from an extension page and sidesteps
 * worker-lifetime limits, and the jsPDF / JSZip bundles load here as plain
 * vendored scripts. The page asks the worker only for data, via GET_EVIDENCE
 * with `for_export: true` (adds `screenshot_ciphertext` / `iv` as base64 — see
 * Role A Prompts/13).
 *
 * A THIRD, separate option wraps whichever plain export the user just built
 * behind a passphrase (crypto/passphrase.js — PBKDF2 + AES-GCM), for safer
 * transport over email/cloud/USB. This never replaces the plain export and
 * never touches the manifest/signature/README inside it — see
 * crypto/passphrase.js's header for why those must stay independently
 * verifiable without a password.
 *
 * Everything is behind seams so tests never touch chrome.* or the real libs.
 */

import { envelope, MSG } from "../../shared/messages.js";
import { buildPdfReport, pdfReportFilename } from "../../export/pdf-report.js";
import { buildPackageZip, packageZipFilename } from "../../export/package-zip.js";
import {
  encryptWithPassphrase,
  MIN_PASSPHRASE_LENGTH,
  passphraseExportFilename
} from "../../crypto/passphrase.js";

/** Production seam: GET_EVIDENCE (for_export) -> record data for the builders. */
export const chromeExportApi = {
  /**
   * @param {string} evidence_id
   * @returns {Promise<object>} { manifest, created_at, last_verification,
   *   screenshotDataUrl, screenshot_ciphertext?, iv? }
   */
  async getForExport(evidence_id) {
    const res = await chrome.runtime.sendMessage(
      envelope(MSG.GET_EVIDENCE, { evidence_id, for_export: true })
    );
    if (!res || !res.ok) {
      throw new Error((res && res.error) || "Could not load the record for export.");
    }
    return res;
  }
};

/** Production seam: hand a Blob to the browser's download manager. */
export const chromeDownloader = {
  /**
   * @param {Uint8Array} bytes
   * @param {string} mime
   * @param {string} filename
   * @returns {Promise<void>}
   */
  async save(bytes, mime, filename) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    try {
      await chrome.downloads.download({ url, filename, saveAs: true });
    } finally {
      // The download manager has read the blob by the time the promise settles,
      // but give it a beat before releasing the URL.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }
};

/**
 * Production seam: the passphrase-wrap download counter, persisted per record
 * in the vault's `settings` store (storage/vault-repo.js). Bounds only the
 * wrapped export — the plain PDF/ZIP export is unlimited.
 */
export const chromePassphraseLimitApi = {
  /**
   * @param {string} evidence_id
   * @returns {Promise<{ count: number, remaining: number, limit: number }>}
   */
  async getStatus(evidence_id) {
    const res = await chrome.runtime.sendMessage(
      envelope(MSG.GET_PASSPHRASE_EXPORT_STATUS, { evidence_id })
    );
    if (!res || !res.ok) {
      throw new Error((res && res.error) || "Could not read the export limit for this record.");
    }
    return { count: res.count, remaining: res.remaining, limit: res.limit };
  },
  /**
   * Call ONLY after the wrapped file has actually reached chrome.downloads —
   * this counts downloads, not attempts.
   * @param {string} evidence_id
   * @returns {Promise<{ count: number, remaining: number, limit: number }>}
   */
  async recordDownload(evidence_id) {
    const res = await chrome.runtime.sendMessage(
      envelope(MSG.RECORD_PASSPHRASE_EXPORT, { evidence_id })
    );
    if (!res || !res.ok) {
      const err = new Error((res && res.error) || "Could not record this export.");
      if (res?.limitReached) err.limitReached = true;
      throw err;
    }
    return { count: res.count, remaining: res.remaining, limit: res.limit };
  }
};

/**
 * @param {{
 *   exportApi?: { getForExport: (id: string) => Promise<object> },
 *   downloader?: { save: (bytes: Uint8Array, mime: string, filename: string) => Promise<void> },
 *   buildPdf?: typeof buildPdfReport,
 *   buildZip?: typeof buildPackageZip,
 *   encryptForExport?: typeof encryptWithPassphrase,
 *   passphraseLimitApi?: {
 *     getStatus: (id: string) => Promise<{count:number, remaining:number, limit:number}>,
 *     recordDownload: (id: string) => Promise<{count:number, remaining:number, limit:number}>
 *   }
 * }} [opts]
 * @returns {{ element: HTMLElement, open: (id: string) => void, close: () => void }}
 */
export function createExportController({
  exportApi = chromeExportApi,
  downloader = chromeDownloader,
  buildPdf = buildPdfReport,
  buildZip = buildPackageZip,
  encryptForExport = encryptWithPassphrase,
  passphraseLimitApi = chromePassphraseLimitApi
} = {}) {
  const element = document.createElement("section");
  element.className = "nk-export";
  element.hidden = true;

  let evidenceId = null;
  let busy = false;

  const status = document.createElement("p");
  status.className = "nk-export__status";

  function setStatus(text, kind) {
    status.textContent = text || "";
    status.dataset.kind = kind || "";
  }

  /**
   * Builds the plain export bytes for one record. Shared by the direct
   * PDF/ZIP buttons and the passphrase-wrap flow below, so wrapping never
   * re-implements — and can never silently drift from — what a plain export
   * actually contains.
   *
   * @param {"pdf"|"zip"} kind
   * @param {string} id
   * @returns {Promise<{ bytes: Uint8Array, mime: string, filename: string }>}
   */
  async function buildExportBytes(kind, id) {
    const res = await exportApi.getForExport(id);
    const record = {
      evidence_id: id,
      manifest: res.manifest,
      screenshot_ciphertext: res.screenshot_ciphertext,
      iv: res.iv
    };
    const verification = res.last_verification ?? null;

    if (kind === "pdf") {
      const { bytes } = buildPdf(
        { record, verification, screenshotDataUrl: res.screenshotDataUrl },
        {}
      );
      return { bytes, mime: "application/pdf", filename: pdfReportFilename(id) };
    }

    if (res.screenshot_ciphertext == null) {
      throw new Error(
        "This build cannot export the package yet — the vault must return the " +
          "screenshot ciphertext (see Role A Prompts/13)."
      );
    }
    const bytes = await buildZip({ record, verification }, {});
    return { bytes, mime: "application/zip", filename: packageZipFilename(id) };
  }

  async function run(kind) {
    if (busy || !evidenceId) return;
    busy = true;
    setButtonsDisabled(true);
    const id = evidenceId;
    try {
      setStatus(`Preparing the ${kind === "pdf" ? "report" : "package"} for ${id}…`, "working");
      const { bytes, mime, filename } = await buildExportBytes(kind, id);
      await downloader.save(bytes, mime, filename);
      setStatus(`Saved ${filename}.`, "done");
    } catch (err) {
      setStatus(`Export did not complete: ${err?.message || err}`, "error");
    } finally {
      busy = false;
      setButtonsDisabled(false);
    }
  }

  /**
   * Refreshes the remaining-downloads display and the disabled state of the
   * whole passphrase-wrap section. Called on open() and after every attempt,
   * so the count shown is never stale.
   * @param {string} id
   */
  async function refreshLimitDisplay(id) {
    try {
      const { count, remaining, limit } = await passphraseLimitApi.getStatus(id);
      setEncLimitNote(count, remaining, limit);
      setEncControlsDisabled(remaining <= 0);
      return remaining;
    } catch {
      // A status-read failure should not block the feature outright — the
      // atomic check in recordDownload (after a real attempt) is the actual
      // enforcement. This is best-effort UI information only.
      setEncLimitNote(null, null, null);
      return null;
    }
  }

  async function runEncrypted() {
    if (busy || !evidenceId) return;
    const kind = encKindSelect.value === "zip" ? "zip" : "pdf";
    const passphrase = encPassInput.value;
    const confirm = encConfirmInput.value;

    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      setEncStatus(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`, "error");
      return;
    }
    if (passphrase !== confirm) {
      setEncStatus("The two passphrase entries do not match.", "error");
      return;
    }

    busy = true;
    setButtonsDisabled(true);
    const id = evidenceId;
    try {
      // Re-check right before doing any work: the count may have moved since
      // this panel opened (another tab on the same record, for instance).
      //
      // NOTE on enforcement: for the ordinary single-tab case this pre-check
      // plus the disabled-button state after each success is what makes "at
      // most `limit` downloads" deterministic — once recordDownload() below
      // reports remaining:0, the whole section disables and a further click
      // never reaches this function at all. The ATOMIC guarantee against a
      // genuine race (two tabs open on the same record at once) lives in
      // vaultRepo.recordPassphraseExport, called via recordDownload() further
      // down — but that call happens AFTER the file is already handed to
      // chrome.downloads, because a completed browser download cannot be
      // un-downloaded. So a true concurrent race can let one extra file
      // through before the count catches up; it can never let a fourth
      // DOWNLOAD ATTEMPT start once this tab has already seen remaining:0.
      const remaining = await refreshLimitDisplay(id);
      if (remaining !== null && remaining <= 0) {
        setEncStatus(
          `The passphrase-protected copy of ${id} has already been downloaded the maximum ` +
            "number of times. The plain (unwrapped) export above has no such limit.",
          "error"
        );
        return;
      }

      setEncStatus(
        `Building the ${kind === "pdf" ? "report" : "package"} and encrypting it…`,
        "working"
      );
      const { bytes } = await buildExportBytes(kind, id);
      const wrapped = await encryptForExport(bytes, passphrase);
      const filename = passphraseExportFilename(id, kind);
      await downloader.save(wrapped, "application/octet-stream", filename);
      // Never leave a chosen passphrase sitting in the DOM after use.
      encPassInput.value = "";
      encConfirmInput.value = "";

      // Count the download ONLY now that the file has actually been handed to
      // chrome.downloads — a build/encrypt failure above must not cost an
      // attempt.
      let after;
      try {
        after = await passphraseLimitApi.recordDownload(id);
      } catch (recordErr) {
        // The file is already saved; a bookkeeping failure here should not
        // read as "your export failed" — say so plainly and move on.
        setEncStatus(
          `Saved ${filename}, but the download count could not be updated ` +
            `(${recordErr?.message || recordErr}).`,
          "done"
        );
        return;
      }
      setEncLimitNote(after.count, after.remaining, after.limit);
      setEncControlsDisabled(after.remaining <= 0);
      setEncStatus(
        `Saved ${filename}. Keep the passphrase separate from the file — ` +
          "EVOCK does not store it and cannot recover it.",
        "done"
      );
    } catch (err) {
      setEncStatus(`Encryption did not complete: ${err?.message || err}`, "error");
    } finally {
      busy = false;
      setButtonsDisabled(false);
    }
  }

  const pdfBtn = actionButton("Human-readable report (PDF)", () => run("pdf"));
  const zipBtn = actionButton("Evidence package (ZIP)", () => run("zip"));
  const closeBtn = actionButton("Close", () => close());
  closeBtn.classList.add("nk-export__close");

  // --- Passphrase-wrapped copy — a separate, opt-in third option ----------
  const encKindSelect = document.createElement("select");
  encKindSelect.className = "nk-export__enc-select";
  for (const [value, label] of [
    ["pdf", "Human-readable report (PDF)"],
    ["zip", "Evidence package (ZIP)"]
  ]) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    encKindSelect.append(opt);
  }

  const encPassInput = document.createElement("input");
  encPassInput.type = "password";
  encPassInput.placeholder = "Passphrase";
  encPassInput.autocomplete = "new-password";
  encPassInput.className = "nk-export__enc-input";

  const encConfirmInput = document.createElement("input");
  encConfirmInput.type = "password";
  encConfirmInput.placeholder = "Confirm passphrase";
  encConfirmInput.autocomplete = "new-password";
  encConfirmInput.className = "nk-export__enc-input";

  const encBtn = actionButton("Encrypt & Save", () => runEncrypted());

  const encStatus = document.createElement("p");
  encStatus.className = "nk-export__status";
  function setEncStatus(text, kind) {
    encStatus.textContent = text || "";
    encStatus.dataset.kind = kind || "";
  }

  const encNote = document.createElement("p");
  encNote.className = "nk-export__note";
  encNote.textContent =
    "Wraps a copy of the export above behind a passphrase, for safer transport " +
    "(email, cloud, USB). The plain export is unaffected. EVOCK never stores the " +
    "passphrase — if it is lost, the wrapped file cannot be recovered.";

  // Shows "N of LIMIT used" / the limit-reached message. Separate from
  // encStatus, which reports the outcome of the last attempt — this one always
  // reflects the CURRENT count, even before the user has tried anything.
  const encLimitNote = document.createElement("p");
  encLimitNote.className = "nk-export__enc-limit";
  /** @param {number|null} count @param {number|null} remaining @param {number|null} limit */
  function setEncLimitNote(count, remaining, limit) {
    if (limit == null) {
      encLimitNote.textContent = "";
      return;
    }
    encLimitNote.textContent =
      remaining > 0
        ? `${count} of ${limit} passphrase-protected downloads used for this record ` +
          `(${remaining} remaining).`
        : `The maximum of ${limit} passphrase-protected downloads has been used for this ` +
          "record. The plain export above is still unlimited.";
    encLimitNote.dataset.kind = remaining > 0 ? "" : "error";
  }

  const encRow = document.createElement("div");
  encRow.className = "nk-export__enc-row";
  encRow.append(encKindSelect, encPassInput, encConfirmInput, encBtn);

  const encHeading = document.createElement("h4");
  encHeading.className = "nk-export__enc-title";
  encHeading.textContent = "Passphrase-protected copy";

  const encSection = document.createElement("div");
  encSection.className = "nk-export__enc";
  encSection.append(encHeading, encNote, encLimitNote, encRow, encStatus);

  // Once the per-record limit is reached, the whole section stays disabled
  // regardless of `busy` — re-checked by setButtonsDisabled below so a normal
  // busy->idle transition can never accidentally re-enable it.
  let limitReached = false;
  function setEncControlsDisabled(v) {
    limitReached = v;
    encKindSelect.disabled = v;
    encPassInput.disabled = v;
    encConfirmInput.disabled = v;
    encBtn.disabled = v || busy;
  }

  function setButtonsDisabled(v) {
    pdfBtn.disabled = v;
    zipBtn.disabled = v;
    encBtn.disabled = v || limitReached;
  }

  const row = document.createElement("div");
  row.className = "nk-export__actions";
  row.append(pdfBtn, zipBtn, closeBtn);

  const heading = document.createElement("h3");
  heading.className = "nk-export__title";
  heading.textContent = "Export this record";

  const note = document.createElement("p");
  note.className = "nk-export__note";
  note.textContent =
    "Both outputs are built on this page and saved to your downloads. Nothing is uploaded.";

  element.append(heading, row, note, status, encSection);

  function open(id) {
    evidenceId = id;
    busy = false;
    // Start each record enabled and with a blank count; refreshLimitDisplay
    // fills the real numbers in asynchronously (it has its own try/catch, so
    // this is a deliberate fire-and-forget — open() itself stays synchronous,
    // matching every other reset here).
    setEncControlsDisabled(false);
    setEncLimitNote(null, null, null);
    setButtonsDisabled(false);
    setStatus("");
    setEncStatus("");
    encPassInput.value = "";
    encConfirmInput.value = "";
    element.hidden = false;
    refreshLimitDisplay(id);
  }

  function close() {
    element.hidden = true;
    setStatus("");
    setEncStatus("");
    encPassInput.value = "";
    encConfirmInput.value = "";
  }

  return { element, open, close };
}

function actionButton(text, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "nk-export__btn";
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}
