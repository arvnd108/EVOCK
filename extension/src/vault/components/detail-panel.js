/**
 * EVOCK — evidence detail panel (Role C, step 04 / C3 part 2).
 *
 * One record, everything about it: the decrypted screenshot, the AI-derived
 * metadata block (tinted + labelled), the capture context, and the integrity
 * block. Data comes through a `detailApi` seam — the real one is one round-trip
 * to the service worker (GET_EVIDENCE).
 *
 * Screenshot transport (coordination item from docs/role-b-status.md §5 —
 * RESOLVED by Role A): the worker returns a base64 `screenshotDataUrl`, not a
 * worker-side object URL. The panel converts it to a Blob and creates its OWN
 * object URL for the <img>, then revokes it on close / on navigating to another
 * record, so decrypted image data does not accumulate for the session
 * (Role C.md §C3, Task 6).
 */

import { envelope, MSG } from "../../shared/messages.js";
import { formatDay } from "./record-card.js";
import { renderDerivedMetadataBlock } from "./derived-metadata-block.js";
import { renderIntegrityBlock } from "./integrity-block.js";

/** Production seam: GET_EVIDENCE -> { manifest, created_at, ..., screenshotDataUrl }. */
export const chromeDetailApi = {
  /**
   * @param {string} evidence_id
   * @returns {Promise<object>}
   */
  async get(evidence_id) {
    const res = await chrome.runtime.sendMessage(envelope(MSG.GET_EVIDENCE, { evidence_id }));
    if (!res || !res.ok) {
      throw new Error((res && res.error) || "Could not load the record.");
    }
    return res;
  }
};

/**
 * "2026-09-01T23:31:14+05:30" -> "1 Sep 2026, 23:31:14 +05:30".
 * Parsed from the string's own fields — locale-independent, no Date.
 * @param {string} iso
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
 * @param {string} dataUrl "data:image/png;base64,...."
 * @returns {Blob}
 */
function dataUrlToBlob(dataUrl) {
  const s = String(dataUrl || "");
  const comma = s.indexOf(",");
  const header = comma === -1 ? "" : s.slice(0, comma);
  const body = comma === -1 ? "" : s.slice(comma + 1);
  const mimeMatch = /^data:([^;,]+)/.exec(header);
  const mime = mimeMatch ? mimeMatch[1] : "image/png";
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Create a reusable detail panel.
 *
 * @param {{
 *   detailApi?: { get: (id: string) => Promise<object> },
 *   onVerify?: (id: string) => void,
 *   onExport?: (id: string) => void,
 *   onClose?: () => void
 * }} [opts]
 * @returns {{ element: HTMLElement, show: (id: string) => Promise<void>, close: () => void }}
 */
export function createDetailPanel({
  detailApi = chromeDetailApi,
  onVerify,
  onExport,
  onClose
} = {}) {
  const element = document.createElement("section");
  element.className = "nk-detail";
  element.hidden = true;

  /** @type {string|null} */
  let objectUrl = null;

  function releaseImage() {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  }

  function close() {
    releaseImage();
    element.replaceChildren();
    element.hidden = true;
    onClose?.();
  }

  async function show(evidenceId) {
    // Navigating to another record must free the previous image first.
    releaseImage();
    const res = await detailApi.get(evidenceId);
    const blob = dataUrlToBlob(res.screenshotDataUrl);
    objectUrl = URL.createObjectURL(blob);
    element.replaceChildren(buildBody(evidenceId, res, objectUrl, { onVerify, onExport, close }));
    element.hidden = false;
  }

  return { element, show, close };
}

function buildBody(evidenceId, res, imageUrl, { onVerify, onExport, close }) {
  const frag = document.createDocumentFragment();
  const manifest = res.manifest || {};
  const source = manifest.source || {};
  const capture = manifest.capture || {};

  // --- Header: id + actions ---
  const header = document.createElement("div");
  header.className = "nk-detail__header";
  const id = document.createElement("h2");
  id.className = "nk-detail__id";
  id.textContent = evidenceId;
  const actions = document.createElement("div");
  actions.className = "nk-detail__actions";
  actions.append(
    // manifest is handed on so the verify panel can source the recorded hashes.
    actionButton("Verify", () => onVerify?.(evidenceId, manifest)),
    actionButton("Export ▾", () => onExport?.(evidenceId)),
    actionButton("Close", () => close())
  );
  header.append(id, actions);
  frag.append(header);

  // --- Original screenshot ---
  const shot = section("Original screenshot");
  const img = document.createElement("img");
  img.className = "nk-detail__screenshot";
  img.alt = `Preserved screenshot for ${evidenceId}`;
  img.src = imageUrl;
  shot.append(img);
  frag.append(shot);

  // --- Visible information (AI-derived) ---
  const visible = section("Visible information");
  visible.append(renderDerivedMetadataBlock(manifest.ai_derived_metadata || null));
  frag.append(visible);

  // --- Capture context ---
  const ctx = section("Capture context");
  const kv = document.createElement("div");
  kv.className = "nk-kv";
  kvRow(kv, "URL", source.url || "—", !source.url);
  kvRow(kv, "Domain", source.domain || "—", !source.domain);
  kvRow(kv, "Tab title", source.tab_title || "—", !source.tab_title);
  // Honesty rule 2: this row is "Device time", never "Trusted timestamp".
  kvRow(kv, "Device time", formatDeviceTime(capture.device_captured_at || res.created_at), false);
  ctx.append(kv);
  frag.append(ctx);

  // --- Integrity (incl. the separate trusted-timestamp row) ---
  const integ = section("Integrity");
  integ.append(renderIntegrityBlock(manifest));
  frag.append(integ);

  return frag;
}

function section(titleText) {
  const s = document.createElement("div");
  s.className = "nk-detail__section";
  const h = document.createElement("h3");
  h.className = "nk-detail__section-title";
  h.textContent = titleText;
  s.append(h);
  return s;
}

function kvRow(kv, keyText, valText, muted) {
  const key = document.createElement("span");
  key.className = "nk-kv__key";
  key.textContent = keyText;
  const val = document.createElement("span");
  val.className = muted ? "nk-kv__val nk-kv__val--muted" : "nk-kv__val";
  val.textContent = valText;
  kv.append(key, val);
}

function actionButton(text, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}
