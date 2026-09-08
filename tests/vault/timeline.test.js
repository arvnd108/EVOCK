// @vitest-environment jsdom
/**
 * EVOCK — chronological timeline grouping (Role C, step 03 / C3, spec §17).
 */

import { describe, expect, it, vi } from "vitest";
import { groupByDay, renderTimeline } from "../../extension/src/vault/components/timeline.js";
import { makeVaultList } from "../helpers/make-vault.js";
import { loadUiFixture } from "../helpers/ui-fixtures.js";

const NOW = Date.parse("2026-09-08T12:00:00+05:30");

describe("groupByDay", () => {
  it("groups by calendar day and preserves input order", () => {
    const items = [
      { evidence_id: "a", created_at: "2026-08-14T17:00:00+05:30" },
      { evidence_id: "b", created_at: "2026-08-14T09:00:00+05:30" },
      { evidence_id: "c", created_at: "2026-08-13T10:00:00+05:30" }
    ];
    const groups = groupByDay(items);
    expect(groups.map(([day]) => day)).toEqual(["2026-08-14", "2026-08-13"]);
    expect(groups[0][1].map((x) => x.evidence_id)).toEqual(["a", "b"]);
  });
});

describe("renderTimeline", () => {
  it("renders vault.50 grouped into day headers with every row present", () => {
    const items = loadUiFixture("vault.50.sample");
    const el = renderTimeline(items, { now: NOW });

    const days = [...el.querySelectorAll(".nk-day")];
    const distinctDays = new Set(items.map((x) => x.created_at.slice(0, 10)));
    expect(days).toHaveLength(distinctDays.size);
    expect(days.length).toBeGreaterThanOrEqual(10);

    expect(el.querySelectorAll(".nk-record")).toHaveLength(50);
    // newest group first (input is newest-first)
    expect(days[0].dataset.day).toBe(items[0].created_at.slice(0, 10));
    expect(days[0].querySelector(".nk-day__header").textContent).toMatch(/\d{1,2} \w{3} \d{4}/);
  });

  it("loads no screenshot — zero <img>, no ciphertext text", () => {
    const el = renderTimeline(makeVaultList(50), { now: NOW });
    expect(el.querySelectorAll("img")).toHaveLength(0);
    expect(el.textContent).not.toMatch(/ciphertext|data:image/i);
  });

  it("renders a 50-row timeline well under a generous time budget", () => {
    const items = makeVaultList(50);
    const t0 = performance.now();
    renderTimeline(items, { now: NOW });
    expect(performance.now() - t0).toBeLessThan(400);
  });

  it("threads onDelete to every row so each gets a Delete button", () => {
    const onDelete = vi.fn();
    const items = makeVaultList(5);
    const el = renderTimeline(items, { now: NOW, onDelete });

    const deletes = [...el.querySelectorAll(".nk-record__delete")];
    expect(deletes).toHaveLength(5);
    expect(el.querySelectorAll(".nk-record-row")).toHaveLength(5);

    deletes[2].click();
    expect(onDelete).toHaveBeenCalledWith(items[2].evidence_id);
  });

  it("survives a row with null platform/contact and no verification", () => {
    const el = renderTimeline(
      [
        {
          evidence_id: "NK-9999",
          created_at: "2026-09-05T20:41:03+05:30",
          platform_label: "Unknown",
          contact_label: null,
          source: null,
          capture: null,
          extraction_status: "ok",
          last_verification: null
        }
      ],
      { now: NOW }
    );
    const row = el.querySelector(".nk-record");
    expect(row.querySelector(".nk-record__platform").textContent).toBe("Unknown");
    expect(row.querySelector(".nk-record__contact").textContent).toBe("unknown account");
    expect(row.querySelector(".nk-record__pill").textContent).toContain("Never verified");
  });
});
