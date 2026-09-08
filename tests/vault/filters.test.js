// @vitest-environment jsdom
/**
 * EVOCK — vault filters + sort (Role C, step 03 / C3, Task 4).
 */

import { describe, expect, it, vi } from "vitest";
import {
  applyFilters,
  defaultFilterState,
  platformsPresent,
  renderFilters
} from "../../extension/src/vault/components/filters.js";
import { makeVaultList } from "../helpers/make-vault.js";

const NOW = Date.parse("2026-09-08T12:00:00+05:30");
const OPTS = { now: NOW };
const ITEMS = makeVaultList(50);

describe("platformsPresent", () => {
  it("returns distinct labels in first-seen order (list is newest-first)", () => {
    expect(platformsPresent(ITEMS)).toEqual(["Instagram", "WhatsApp", "Unknown", "Website"]);
  });
});

describe("applyFilters", () => {
  it("does not mutate the input array", () => {
    const copy = ITEMS.slice();
    applyFilters(ITEMS, { sort: "oldest", platforms: ["WhatsApp"] }, OPTS);
    expect(ITEMS).toEqual(copy);
  });

  it("platform filter keeps only the selected platforms", () => {
    const out = applyFilters(ITEMS, { platforms: ["WhatsApp"] }, OPTS);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(ITEMS.length);
    expect(out.every((x) => x.platform_label === "WhatsApp")).toBe(true);
  });

  it("verification=never keeps only rows with no last_verification", () => {
    const out = applyFilters(ITEMS, { verification: "never" }, OPTS);
    expect(out).toHaveLength(10);
    expect(out.every((x) => x.last_verification == null)).toBe(true);
  });

  it("verification=modified keeps only rows whose last check found tampering", () => {
    const out = applyFilters(ITEMS, { verification: "modified" }, OPTS);
    expect(out).toHaveLength(10);
    expect(out.every((x) => x.last_verification?.status === "MODIFIED")).toBe(true);
  });

  it("verification=verified and =stale partition the recent/old VERIFIED rows", () => {
    const verified = applyFilters(ITEMS, { verification: "verified" }, OPTS);
    const stale = applyFilters(ITEMS, { verification: "stale" }, OPTS);
    expect(verified).toHaveLength(20);
    expect(stale).toHaveLength(10);
    expect(verified.every((x) => x.last_verification?.status === "VERIFIED")).toBe(true);
    expect(stale.every((x) => x.last_verification?.status === "VERIFIED")).toBe(true);
  });

  it("date range is inclusive on both ends", () => {
    const out = applyFilters(ITEMS, { dateFrom: "2026-08-05", dateTo: "2026-08-07" }, OPTS);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((x) => x.created_at.slice(0, 10) >= "2026-08-05")).toBe(true);
    expect(out.every((x) => x.created_at.slice(0, 10) <= "2026-08-07")).toBe(true);
  });

  it("sort newest/oldest orders by created_at", () => {
    const newest = applyFilters(ITEMS, { sort: "newest" }, OPTS).map((x) => x.created_at);
    const oldest = applyFilters(ITEMS, { sort: "oldest" }, OPTS).map((x) => x.created_at);
    expect(newest).toEqual([...newest].sort().reverse());
    expect(oldest).toEqual([...oldest].sort());
  });

  it("combines platform and verification filters (AND)", () => {
    const out = applyFilters(ITEMS, { platforms: ["Instagram"], verification: "never" }, OPTS);
    expect(out.every((x) => x.platform_label === "Instagram" && x.last_verification == null)).toBe(
      true
    );
  });
});

describe("renderFilters", () => {
  it("builds a checkbox per present platform and a 6-option verification select", () => {
    const el = renderFilters(ITEMS, {});
    const boxes = [...el.querySelectorAll('input[type="checkbox"]')].map((b) => b.value);
    expect(boxes).toEqual(["Instagram", "WhatsApp", "Unknown", "Website"]);
    const select = el.querySelector('select[aria-label="Verification status"]');
    expect([...select.options].map((o) => o.value)).toEqual([
      "all",
      "verified",
      "stale",
      "modified",
      "error",
      "never"
    ]);
  });

  it("emits an updated FilterState when a control changes", () => {
    const onChange = vi.fn();
    const el = renderFilters(ITEMS, { onChange });

    const wa = el.querySelector('input[type="checkbox"][value="WhatsApp"]');
    wa.checked = true;
    wa.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ platforms: ["WhatsApp"] }));

    const select = el.querySelector('select[aria-label="Verification status"]');
    select.value = "stale";
    select.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ verification: "stale" }));

    const sort = el.querySelector('select[aria-label="Sort order"]');
    sort.value = "oldest";
    sort.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "oldest" }));
  });
});

describe("defaultFilterState", () => {
  it("is 'show everything, newest first'", () => {
    expect(defaultFilterState()).toEqual({
      platforms: [],
      dateFrom: null,
      dateTo: null,
      verification: "all",
      sort: "newest"
    });
  });
});
