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
import { formatDeviceTime } from "./record-card.js";
import { renderDerivedMetadataBlock } from "./derived-metadata-block.js";
import { renderIntegrityBlock } from "./integrity-block.js";
import { renderVersionHistory } from "./review-editor.js";

// Re-exported for callers/tests that imported it from here in step 04.
export { formatDeviceTime } from "./record-card.js";

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
 * A record's version list. Pre-`versions[]` records (a single AI-derived
 * manifest) become one implicit version so the panel is uniform either way.
 * @param {object} res GET_EVIDENCE response
 * @returns {Array<{ version: number, origin: string, created_at: string, manifest: object }>}
 */
export function normalizeVersions(res) {
  if (Array.isArray(res.versions) && res.versions.length > 0) return res.versions;
  return [
    {
      version: 1,
      origin: "ai",
      author: null,
      note: null,
      created_at: res.manifest?.signature?.signed_at || res.created_at || null,
      manifest: res.manifest || {}
    }
  ];
}

/**
 * Create a reusable detail panel.
 *
 * @param {{
 *   detailApi?: { get: (id: string) => Promise<object> },
 *   onVerify?: (id: string, manifest: object, version?: number) => void,
 *   onExport?: (id: string) => void,
 *   onEditMetadata?: (id: string, data: object|null) => void,
 *   onClose?: () => void
 * }} [opts]
 * @returns {{ element: HTMLElement, show: (id: string) => Promise<void>, close: () => void }}
 */
export function createDetailPanel({
  detailApi = chromeDetailApi,
  onVerify,
  onExport,
  onEditMetadata,
  onClose
} = {}) {
  const element = document.createElement("section");
  element.className = "nk-detail";
  element.hidden = true;

  /** @type {string|null} */
  let objectUrl = null;
  /** @type {{ evidenceId: string, res: object, versions: any[] } | null} */
  let current = null;

  function releaseImage() {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  }

  function close() {
    releaseImage();
    current = null;
    element.replaceChildren();
    element.hidden = true;
    onClose?.();
  }

  function renderVersion(selected) {
    if (!current) return;
    const { evidenceId, res, versions } = current;
    element.replaceChildren(
      buildBody(evidenceId, res, versions, selected, objectUrl, {
        onVerify,
        onExport,
        onEditMetadata,
        onSelectVersion: renderVersion,
        close
      })
    );
  }

  async function show(evidenceId) {
    // Navigating to another record must free the previous image first.
    releaseImage();
    const res = await detailApi.get(evidenceId);
    const blob = dataUrlToBlob(res.screenshotDataUrl);
    objectUrl = URL.createObjectURL(blob);
    const versions = normalizeVersions(res);
    current = { evidenceId, res, versions };
    renderVersion(versions.length); // default to the latest version
    element.hidden = false;
  }

  return { element, show, close };
}

function buildBody(evidenceId, res, versions, selected, imageUrl, handlers) {
  const { onVerify, onExport, onEditMetadata, onSelectVersion, close } = handlers;
  const total = versions.length;
  const clamped = Math.min(Math.max(selected, 1), total);
  const active = versions[clamped - 1];
  const manifest = active?.manifest || res.manifest || {};
  const isLatest = clamped === total;
  const source = manifest.source || {};
  const capture = manifest.capture || {};

  const frag = document.createDocumentFragment();

  // --- Header: id + actions ---
  const header = document.createElement("div");
  header.className = "nk-detail__header";
  const id = document.createElement("h2");
  id.className = "nk-detail__id";
  id.textContent =
    total > 1 ? `${evidenceId} · v${clamped}${isLatest ? " (latest)" : ""}` : evidenceId;
  const actions = document.createElement("div");
  actions.className = "nk-detail__actions";
  actions.append(
    // manifest is handed on so the verify panel can source the recorded hashes.
    // version is passed only when an OLDER version is selected — omitted for
    // the latest, so the worker still treats this as the record's current
    // verification (persisted onto last_verification, updates the timeline
    // pill). Passing the recorded hash from an old manifest against a current
    // hash recomputed for the latest would report a correctly-signed older
    // version as MODIFIED for no reason.
    actionButton("Verify", () => onVerify?.(evidenceId, manifest, isLatest ? undefined : clamped)),
    actionButton("Export ▾", () => onExport?.(evidenceId)),
    actionButton("Close", () => close())
  );
  header.append(id, actions);
  frag.append(header);

  // --- Version history (only once there is more than one version) ---
  if (total > 1) {
    const vs = section("Versions");
    const note = document.createElement("p");
    note.className = "nk-detail__version-note";
    note.textContent =
      "A correction is kept as a new signed version. Selecting one below shows that " +
      "version's metadata; the screenshot is the same for every version.";
    vs.append(
      note,
      renderVersionHistory(versions, { selected: clamped, onSelect: onSelectVersion })
    );
    frag.append(vs);
  }

  // --- Original screenshot (shared across versions) ---
  const shot = section("Original screenshot");
  const img = document.createElement("img");
  img.className = "nk-detail__screenshot";
  img.alt = `Preserved screenshot for ${evidenceId}`;
  img.src = imageUrl;
  shot.append(img);
  frag.append(shot);

  // --- Visible information (AI-derived / this version) ---
  const visible = section("Visible information");
  visible.append(
    renderDerivedMetadataBlock(manifest.ai_derived_metadata || null, {
      // Corrections build on the latest version only.
      onEdit:
        onEditMetadata && isLatest
          ? () => onEditMetadata(evidenceId, manifest.ai_derived_metadata?.data ?? null)
          : undefined
    })
  );
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
