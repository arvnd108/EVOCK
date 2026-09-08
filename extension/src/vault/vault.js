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
import { applyFilters, defaultFilterState, renderFilters } from "./components/filters.js";
import { renderEmptyState } from "./components/empty-state.js";
import { renderTimeline } from "./components/timeline.js";

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
 *   vaultApi?: { list: (q?: object) => Promise<object[]> },
 *   now?: number,
 *   onSelect?: (evidenceId: string) => void
 * }} [opts]
 * @returns {Promise<{ refresh: () => void }>}
 */
export async function initVault(
  mount,
  { vaultApi = chromeVaultApi, now = Date.now(), onSelect } = {}
) {
  const all = await vaultApi.list({ sort: "newest" });

  const countEl = document.getElementById("vault-count");
  const filtersEl = document.getElementById("vault-filters");

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

    mount.replaceChildren(
      all.length === 0
        ? renderEmptyState()
        : visible.length === 0
          ? renderNoMatches()
          : renderTimeline(visible, { onSelect, now })
    );
  };

  if (filtersEl) {
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
  }

  paint();
  return { refresh: paint };
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
    initVault(auto).catch((err) => {
      auto.replaceChildren();
      const box = document.createElement("div");
      box.className = "nk-vault__error";
      box.textContent = `Could not load the vault: ${err?.message || err}`;
      auto.append(box);
    });
  }
}
