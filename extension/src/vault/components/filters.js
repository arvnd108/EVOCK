/**
 * EVOCK — vault filters + sort (Role C, step 03 / C3).
 *
 * `applyFilters` is the pure, testable core: (items, state) -> items. For the
 * MVP everything is applied client-side over the full fetched list; if a vault
 * ever holds hundreds of records, push `filter` down into LIST_EVIDENCE instead
 * (Role C.md §C3, Task 4).
 *
 * `renderFilters` builds the controls and calls `onChange(nextState)`.
 */

import { verificationPill } from "./record-card.js";

/**
 * @typedef {Object} FilterState
 * @property {string[]} platforms      selected platform labels; [] means "all"
 * @property {string|null} dateFrom    "YYYY-MM-DD" inclusive lower bound
 * @property {string|null} dateTo      "YYYY-MM-DD" inclusive upper bound
 * @property {"all"|"verified"|"stale"|"modified"|"error"|"never"} verification
 * @property {"newest"|"oldest"} sort
 */

/** @returns {FilterState} */
export function defaultFilterState() {
  return {
    platforms: [],
    dateFrom: null,
    dateTo: null,
    verification: "all",
    sort: "newest"
  };
}

/**
 * Distinct platform labels present in the data, in first-seen order.
 * @param {Array<{ platform_label?: string }>} items
 * @returns {string[]}
 */
export function platformsPresent(items) {
  const seen = [];
  for (const it of items) {
    const p = it.platform_label || "Unknown";
    if (!seen.includes(p)) seen.push(p);
  }
  return seen;
}

/**
 * @param {object[]} items
 * @param {FilterState} state
 * @param {{ now?: number, staleAfterDays?: number }} [opts]
 * @returns {object[]} a new, filtered + sorted array
 */
export function applyFilters(items, state, opts = {}) {
  const s = { ...defaultFilterState(), ...state };
  const out = items.filter((item) => {
    if (s.platforms.length > 0) {
      const p = item.platform_label || "Unknown";
      if (!s.platforms.includes(p)) return false;
    }

    const day = String(item.created_at || "").slice(0, 10);
    if (s.dateFrom && day && day < s.dateFrom) return false;
    if (s.dateTo && day && day > s.dateTo) return false;

    if (s.verification !== "all") {
      const { state: pillState } = verificationPill(item.last_verification ?? null, opts);
      if (pillState !== s.verification) return false;
    }

    return true;
  });

  out.sort((a, b) => {
    const av = String(a.created_at || "");
    const bv = String(b.created_at || "");
    return s.sort === "oldest" ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  return out;
}

const VERIFICATION_OPTIONS = [
  ["all", "All"],
  ["verified", "Verified"],
  ["stale", "Stale"],
  ["modified", "Modified"],
  ["error", "Verify error"],
  ["never", "Never verified"]
];

function group(legendText) {
  const g = document.createElement("div");
  g.className = "nk-filter-group";
  const legend = document.createElement("span");
  legend.className = "nk-filter-legend";
  legend.textContent = legendText;
  g.append(legend);
  return g;
}

/**
 * @param {object[]} items the full fetched list (for deriving platform options).
 * @param {{ state?: FilterState, onChange?: (next: FilterState) => void }} [opts]
 * @returns {HTMLElement} `<div class="nk-filters">`
 */
export function renderFilters(items, { state = defaultFilterState(), onChange } = {}) {
  const current = { ...defaultFilterState(), ...state };
  const root = document.createElement("div");
  root.className = "nk-filters";

  const emit = () => onChange?.({ ...current, platforms: [...current.platforms] });

  // Platform (multi-select checkboxes)
  const platformGroup = group("Platform");
  const platformOptions = document.createElement("div");
  platformOptions.className = "nk-filter-options";
  for (const platform of platformsPresent(items)) {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = platform;
    cb.checked = current.platforms.includes(platform);
    cb.addEventListener("change", () => {
      current.platforms = cb.checked
        ? [...current.platforms, platform]
        : current.platforms.filter((p) => p !== platform);
      emit();
    });
    label.append(cb, document.createTextNode(platform));
    platformOptions.append(label);
  }
  platformGroup.append(platformOptions);

  // Date range
  const dateGroup = group("Date range");
  const dateRow = document.createElement("div");
  dateRow.className = "nk-filter-options";
  const from = document.createElement("input");
  from.type = "date";
  from.setAttribute("aria-label", "From date");
  from.value = current.dateFrom || "";
  const to = document.createElement("input");
  to.type = "date";
  to.setAttribute("aria-label", "To date");
  to.value = current.dateTo || "";
  from.addEventListener("change", () => {
    current.dateFrom = from.value || null;
    emit();
  });
  to.addEventListener("change", () => {
    current.dateTo = to.value || null;
    emit();
  });
  dateRow.append(from, to);
  dateGroup.append(dateRow);

  // Verification status
  const verifyGroup = group("Verification");
  const verifySelect = document.createElement("select");
  verifySelect.setAttribute("aria-label", "Verification status");
  for (const [value, text] of VERIFICATION_OPTIONS) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = text;
    if (value === current.verification) opt.selected = true;
    verifySelect.append(opt);
  }
  verifySelect.addEventListener("change", () => {
    current.verification = verifySelect.value;
    emit();
  });
  verifyGroup.append(verifySelect);

  // Sort
  const sortGroup = group("Sort");
  const sortSelect = document.createElement("select");
  sortSelect.setAttribute("aria-label", "Sort order");
  for (const [value, text] of [
    ["newest", "Newest first"],
    ["oldest", "Oldest first"]
  ]) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = text;
    if (value === current.sort) opt.selected = true;
    sortSelect.append(opt);
  }
  sortSelect.addEventListener("change", () => {
    current.sort = sortSelect.value;
    emit();
  });
  sortGroup.append(sortSelect);

  root.append(platformGroup, dateGroup, verifyGroup, sortGroup);
  return root;
}
