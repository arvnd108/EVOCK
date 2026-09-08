/**
 * EVOCK — export menu + download glue (Role C, step 07 / C6).
 *
 * Sits under the detail panel. "Export ▾" opens it; it offers the two outputs
 * and drives them to disk through `chrome.downloads`:
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
 * Everything is behind seams so tests never touch chrome.* or the real libs.
 */

import { envelope, MSG } from "../../shared/messages.js";
import { buildPdfReport, pdfReportFilename } from "../../export/pdf-report.js";
import { buildPackageZip, packageZipFilename } from "../../export/package-zip.js";

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
 * @param {{
 *   exportApi?: { getForExport: (id: string) => Promise<object> },
 *   downloader?: { save: (bytes: Uint8Array, mime: string, filename: string) => Promise<void> },
 *   buildPdf?: typeof buildPdfReport,
 *   buildZip?: typeof buildPackageZip
 * }} [opts]
 * @returns {{ element: HTMLElement, open: (id: string) => void, close: () => void }}
 */
export function createExportController({
  exportApi = chromeExportApi,
  downloader = chromeDownloader,
  buildPdf = buildPdfReport,
  buildZip = buildPackageZip
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

  async function run(kind) {
    if (busy || !evidenceId) return;
    busy = true;
    setButtonsDisabled(true);
    const id = evidenceId;
    try {
      setStatus(`Preparing the ${kind === "pdf" ? "report" : "package"} for ${id}…`, "working");
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
        await downloader.save(bytes, "application/pdf", pdfReportFilename(id));
        setStatus(`Saved ${pdfReportFilename(id)}.`, "done");
      } else {
        if (res.screenshot_ciphertext == null) {
          throw new Error(
            "This build cannot export the package yet — the vault must return the " +
              "screenshot ciphertext (see Role A Prompts/13)."
          );
        }
        const bytes = await buildZip({ record, verification }, {});
        await downloader.save(bytes, "application/zip", packageZipFilename(id));
        setStatus(`Saved ${packageZipFilename(id)}.`, "done");
      }
    } catch (err) {
      setStatus(`Export did not complete: ${err?.message || err}`, "error");
    } finally {
      busy = false;
      setButtonsDisabled(false);
    }
  }

  const pdfBtn = actionButton("Human-readable report (PDF)", () => run("pdf"));
  const zipBtn = actionButton("Evidence package (ZIP)", () => run("zip"));
  const closeBtn = actionButton("Close", () => close());
  closeBtn.classList.add("nk-export__close");

  function setButtonsDisabled(v) {
    pdfBtn.disabled = v;
    zipBtn.disabled = v;
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

  element.append(heading, row, note, status);

  function open(id) {
    evidenceId = id;
    busy = false;
    setButtonsDisabled(false);
    setStatus("");
    element.hidden = false;
  }

  function close() {
    element.hidden = true;
    setStatus("");
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
