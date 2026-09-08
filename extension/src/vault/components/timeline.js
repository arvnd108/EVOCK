/**
 * EVOCK — chronological timeline (Role C, step 03 / C3, spec §17).
 *
 * Groups already-filtered, already-sorted `list()` items by calendar day and
 * renders a day header plus a row per record. Order is preserved from the input
 * array: pass newest-first and the newest day / newest row lands first.
 *
 * Neutral, factual, non-diagnostic throughout — the timeline organises captured
 * facts, it does not label or conclude (spec §17, §36).
 */

import { formatDay, renderRecordCard } from "./record-card.js";

/**
 * Group items by the calendar day of `created_at`, preserving input order both
 * between groups and within a group.
 *
 * @param {Array<{ created_at: string }>} items
 * @returns {Array<[string, object[]]>} `[dayKey ("YYYY-MM-DD"), items]` pairs
 */
export function groupByDay(items) {
  /** @type {Map<string, object[]>} */
  const groups = new Map();
  for (const item of items) {
    const key = String(item.created_at || "").slice(0, 10) || "unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()];
}

/**
 * @param {object[]} items already filtered + sorted.
 * @param {{ onSelect?: (id: string) => void, now?: number }} [opts]
 * @returns {HTMLElement} a `<div class="nk-timeline">`
 */
export function renderTimeline(items, { onSelect, now } = {}) {
  const root = document.createElement("div");
  root.className = "nk-timeline";

  for (const [dayKey, dayItems] of groupByDay(items)) {
    const section = document.createElement("section");
    section.className = "nk-day";
    section.dataset.day = dayKey;

    const header = document.createElement("h2");
    header.className = "nk-day__header";
    header.textContent = dayKey === "unknown" ? "Undated" : formatDay(dayKey);

    const list = document.createElement("div");
    list.className = "nk-day__list";
    for (const item of dayItems) {
      list.append(renderRecordCard(item, { onSelect, now }));
    }

    section.append(header, list);
    root.append(section);
  }

  return root;
}
