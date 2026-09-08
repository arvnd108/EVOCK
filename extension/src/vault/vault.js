/**
 * EVOCK — vault page controller (Role C, step 03 / C3).
 *
 * Fetches the record list once (metadata only), then renders the count, the
 * filter bar and the chronological timeline. Filter and sort are applied
 * client-side over the fetched list for the MVP.
 *
 * Data access goes through a `vaultApi` seam: the real one talks to the service
 * worker over `chrome.runtime.sendMessage`; tests inject a fake so no worker,
 * no IndexedDB and no decryption are involved. This module NEVER imports
 * `vaultRepo` and never handles a screenshot or ciphertext.
 */

import { envelope, MSG } from "../shared/messages.js";
import { createDetailPanel } from "./components/detail-panel.js";
import { applyFilters, defaultFilterState, renderFilters } from "./components/filters.js";
import { renderEmptyState } from "./components/empty-state.js";
import { renderTimeline } from "./components/timeline.js";
import { createReviewController } from "./components/review-editor.js";
import { createVerifyPanel } from "./components/verify-panel.js";
import { createExportController } from "./components/export-controller.js";

/**
 * The production data seam: one round-trip to the service worker.
 * `LIST_EVIDENCE` replies `{ ok, items }` with metadata-only projections.
 */
export const chromeVaultApi = {
  /**
   * @param {{ sort?: "newest"|"oldest", filter?: object }} [query]
   * @returns {Promise<object[]>}
   */
  async list(query = {}) {
    const res = await chrome.runtime.sendMessage(envelope(MSG.LIST_EVIDENCE, query));
    if (!res || !res.ok) {
      throw new Error((res && res.error) || "Could not load the vault.");
    }
    const items = res.items || [];
    assertNoCiphertext(items);
    return items;
  },

  /**
   * Permanently delete one record. The worker owns the IndexedDB write
   * (`vaultRepo.remove`); this is just the round-trip.
   * @param {string} evidence_id
   * @returns {Promise<void>}
   */
  async remove(evidence_id) {
    const res = await chrome.runtime.sendMessage(envelope(MSG.DELETE_EVIDENCE, { evidence_id }));
    if (!res || !res.ok) {
      throw new Error((res && res.error) || "Could not delete the record.");
    }
  },

  /**
   * Permanently delete every record (`vaultRepo.clear` in the worker).
   * @returns {Promise<void>}
   */
  async clear() {
    const res = await chrome.runtime.sendMessage(envelope(MSG.CLEAR_VAULT, {}));
    if (!res || !res.ok) {
      throw new Error((res && res.error) || "Could not clear the vault.");
    }
  }
};

/**
 * Guard the §5 contract: `list()` is metadata only. If a screenshot or
 * ciphertext ever comes back, that is a Role B bug to raise — the vault must not
 * quietly render (or hold a reference to) image bytes.
 * @param {object[]} items
 */
export function assertNoCiphertext(items) {
  for (const it of items) {
    if (
      it &&
      ("screenshot_ciphertext" in it ||
        "iv" in it ||
        "screenshotDataUrl" in it ||
        "screenshot" in it)
    ) {
      throw new Error(
        "LIST_EVIDENCE returned screenshot bytes — the vault list must be metadata only (Building Plan §5.6)."
      );
    }
  }
}

/**
 * Render the vault into `mount`.
 *
 * @param {HTMLElement} mount
 * @param {{
 *   vaultApi?: {
 *     list: (q?: object) => Promise<object[]>,
 *     remove?: (id: string) => Promise<void>,
 *     clear?: () => Promise<void>
 *   },
 *   now?: number,
 *   onSelect?: (evidenceId: string) => void,
 *   onMutate?: () => void,
 *   confirm?: (message: string) => boolean
 * }} [opts]
 * @returns {Promise<{
 *   refresh: () => void,
 *   applyVerification: (id: string, r: object) => void,
 *   deleteRecord: (id: string) => Promise<void>,
 *   clearVault: () => Promise<void>
 * }>}
 */
export async function initVault(
  mount,
  {
    vaultApi = chromeVaultApi,
    now = Date.now(),
    onSelect,
    onMutate,
    confirm = (message) => globalThis.confirm(message)
  } = {}
) {
  const all = await vaultApi.list({ sort: "newest" });

  const countEl = document.getElementById("vault-count");
  const filtersEl = document.getElementById("vault-filters");
  const clearEl = document.getElementById("vault-clear");

  let state = defaultFilterState();

  const paint = () => {
    const visible = applyFilters(all, state, { now });

    if (countEl) {
      countEl.textContent =
        all.length === 0
          ? ""
          : visible.length === all.length
            ? `${all.length} ${all.length === 1 ? "record" : "records"}`
            : `${visible.length} of ${all.length} records`;
    }

    if (clearEl) clearEl.hidden = all.length === 0;

    mount.replaceChildren(
      all.length === 0
        ? renderEmptyState()
        : visible.length === 0
          ? renderNoMatches()
          : renderTimeline(visible, { onSelect, onDelete: handleRowDelete, now })
    );
  };

  const handleRowDelete = (evidence_id) =>
    deleteRecord(evidence_id).catch((err) =>
      showError(mount, `Could not delete ${evidence_id}: ${err?.message || err}`)
    );

  const renderFilterBar = () => {
    if (!filtersEl) return;
    filtersEl.replaceChildren(
      all.length === 0
        ? document.createDocumentFragment()
        : renderFilters(all, {
            state,
            onChange: (next) => {
              state = next;
              paint();
            }
          })
    );
  };

  /** Drop `evidence_id` from the in-memory list and re-sync every surface. */
  const forget = (evidence_id) => {
    const i = all.findIndex((x) => x.evidence_id === evidence_id);
    if (i !== -1) all.splice(i, 1);
  };

  const resync = () => {
    renderFilterBar();
    paint();
    onMutate?.();
  };

  /**
   * "Delete" on one row. Confirms, deletes through the vault seam, then removes
   * the row locally so the count and timeline update without a re-fetch.
   * @param {string} evidence_id
   */
  async function deleteRecord(evidence_id) {
    if (!confirm(`Permanently delete ${evidence_id}? This cannot be undone.`)) return;
    await vaultApi.remove(evidence_id);
    forget(evidence_id);
    resync();
  }

  /** "Clear" — confirm, then delete every record. */
  async function clearVault() {
    if (all.length === 0) return;
    const noun = all.length === 1 ? "record" : "records";
    if (
      !confirm(
        `Permanently delete all ${all.length} ${noun} from the vault? This cannot be undone.`
      )
    ) {
      return;
    }
    await vaultApi.clear();
    all.length = 0;
    resync();
  }

  if (clearEl) {
    clearEl.addEventListener("click", () => {
      clearVault().catch((err) =>
        showError(mount, `Could not clear the vault: ${err?.message || err}`)
      );
    });
  }

  renderFilterBar();
  paint();

  /**
   * Fold a fresh VerificationResult into the in-memory list and repaint, so the
   * timeline pill reflects a verify run without a re-fetch.
   * @param {string} evidence_id
   * @param {object} result
   */
  function applyVerification(evidence_id, result) {
    const item = all.find((x) => x.evidence_id === evidence_id);
    if (item) {
      item.last_verification = result;
      paint();
    }
  }

  return { refresh: paint, applyVerification, deleteRecord, clearVault };
}

/**
 * Show a transient error line at the top of the vault body. Cleared by the next
 * successful `paint()` (which calls `mount.replaceChildren`).
 * @param {HTMLElement} mount
 * @param {string} message
 */
function showError(mount, message) {
  mount.querySelector(":scope > .nk-vault__error")?.remove();
  const box = document.createElement("div");
  box.className = "nk-vault__error";
  box.textContent = message;
  mount.prepend(box);
}

function renderNoMatches() {
  const el = document.createElement("div");
  el.className = "nk-empty";
  const title = document.createElement("h2");
  title.className = "nk-empty__title";
  title.textContent = "No records match these filters";
  const body = document.createElement("p");
  body.className = "nk-empty__body";
  body.textContent = "Adjust or clear the filters above to see more of the vault.";
  el.append(title, body);
  return el;
}

// --- Auto-bootstrap on the real page only ---------------------------------
// vault.html marks its mount with data-vault-autoinit. Component tests render
// into throwaway elements without that attribute, so importing this module has
// no side effect under test.
if (typeof document !== "undefined") {
  const auto = document.querySelector("[data-vault-autoinit]");
  if (auto) {
    const detailMount = document.getElementById("vault-detail");

    /** @type {{ refresh: () => void, applyVerification: (id: string, r: object) => void } | null} */
    let controller = null;

    const verify = detailMount
      ? createVerifyPanel({
          onResult: (id, result) => controller?.applyVerification(id, result)
        })
      : null;

    /** @type {ReturnType<typeof createDetailPanel> | null} */
    let panel = null;

    const review = detailMount
      ? createReviewController({
          onRevised: (id) => {
            // The record gained a version and last_verification is now stale.
            verify?.close();
            controller?.applyVerification(id, null);
            panel?.show(id).catch(() => {});
          }
        })
      : null;

    const exporter = detailMount ? createExportController() : null;

    panel = detailMount
      ? createDetailPanel({
          onVerify: verify
            ? (id, manifest, version) => {
                verify.run(id, { manifest, version });
                verify.element.scrollIntoView({ behavior: "smooth", block: "start" });
              }
            : undefined,
          onExport: exporter
            ? (id) => {
                exporter.open(id);
                exporter.element.scrollIntoView({ behavior: "smooth", block: "start" });
              }
            : undefined,
          onEditMetadata: review
            ? (id, data) => {
                review.open({ evidenceId: id, data });
                review.element.scrollIntoView({ behavior: "smooth", block: "start" });
              }
            : undefined,
          onClose: () => {
            verify?.close();
            review?.close();
            exporter?.close();
          }
        })
      : null;

    if (panel) detailMount.append(panel.element);
    if (verify) detailMount.append(verify.element);
    if (review) detailMount.append(review.element);
    if (exporter) detailMount.append(exporter.element);

    initVault(auto, {
      // A delete or a clear can pull the record the detail area is showing out
      // from under it — close every open sub-panel after any list mutation.
      onMutate: () => {
        verify?.close();
        review?.close();
        exporter?.close();
        panel?.close();
      },
      onSelect: panel
        ? (id) => {
            verify?.close();
            review?.close();
            exporter?.close();
            panel.show(id).then(
              () => panel.element.scrollIntoView({ behavior: "smooth", block: "start" }),
              (err) => {
                panel.element.hidden = false;
                panel.element.replaceChildren();
                const box = document.createElement("div");
                box.className = "nk-vault__error";
                box.textContent = `Could not open ${id}: ${err?.message || err}`;
                panel.element.append(box);
              }
            );
          }
        : undefined
    }).then(
      (c) => {
        controller = c;
      },
      (err) => {
        auto.replaceChildren();
        const box = document.createElement("div");
        box.className = "nk-vault__error";
        box.textContent = `Could not load the vault: ${err?.message || err}`;
        auto.append(box);
      }
    );
  }
}
