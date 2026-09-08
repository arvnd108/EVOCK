// @vitest-environment jsdom
/**
 * EVOCK — vault record row + verification pill (Role C, step 03 / C3).
 */

import { describe, expect, it, vi } from "vitest";
import {
  formatDay,
  renderRecordCard,
  verificationPill
} from "../../extension/src/vault/components/record-card.js";

const NOW = Date.parse("2026-09-08T12:00:00+05:30");

function item(overrides = {}) {
  return {
    evidence_id: "NK-0007",
    created_at: "2026-09-01T23:31:14+05:30",
    platform_label: "WhatsApp",
    contact_label: "Mr. ABC B",
    last_verification: null,
    ...overrides
  };
}

describe("formatDay", () => {
  it("formats an ISO date locale-independently", () => {
    expect(formatDay("2026-08-14")).toBe("14 Aug 2026");
    expect(formatDay("2026-09-01T23:31:14+05:30")).toBe("1 Sep 2026");
  });
  it("degrades on garbage rather than throwing", () => {
    expect(formatDay("")).toBe("Unknown date");
    expect(formatDay(null)).toBe("Unknown date");
  });
});

describe("verificationPill", () => {
  it("null → never verified", () => {
    const p = verificationPill(null, { now: NOW });
    expect(p.state).toBe("never");
    expect(p.symbol).toBe("—");
    expect(p.className).toContain("nk-pill--never");
  });

  it("recent VERIFIED → verified with date", () => {
    const p = verificationPill(
      { status: "VERIFIED", verified_at: "2026-09-07T09:15:00+05:30" },
      { now: NOW }
    );
    expect(p.state).toBe("verified");
    expect(p.symbol).toBe("✓");
    expect(p.label).toBe("Verified 7 Sep 2026");
  });

  it("old VERIFIED → stale, 'Not verified since <date>'", () => {
    const p = verificationPill(
      { status: "VERIFIED", verified_at: "2026-08-02T20:00:00+05:30" },
      { now: NOW }
    );
    expect(p.state).toBe("stale");
    expect(p.symbol).toBe("⚠");
    expect(p.label).toBe("Not verified since 2 Aug 2026");
  });

  it("MODIFIED → modified, ❌", () => {
    const p = verificationPill(
      { status: "MODIFIED", verified_at: "2026-09-06T18:30:00+05:30" },
      { now: NOW }
    );
    expect(p.state).toBe("modified");
    expect(p.symbol).toBe("❌");
    expect(p.className).toContain("nk-pill--modified");
  });

  it("ERROR → error, ⚠ but distinct from stale", () => {
    const p = verificationPill(
      { status: "ERROR", verified_at: "2026-09-06T18:30:00+05:30" },
      { now: NOW }
    );
    expect(p.state).toBe("error");
    expect(p.className).toContain("nk-pill--error");
  });
});

describe("renderRecordCard", () => {
  it("renders id, platform, contact and pill into a button", () => {
    const el = renderRecordCard(item(), { now: NOW });
    expect(el.tagName).toBe("BUTTON");
    expect(el.dataset.evidenceId).toBe("NK-0007");
    expect(el.querySelector(".nk-record__id").textContent).toBe("NK-0007");
    expect(el.querySelector(".nk-record__platform").textContent).toBe("WhatsApp");
    expect(el.querySelector(".nk-record__contact").textContent).toBe("Mr. ABC B");
    expect(el.querySelector(".nk-record__pill").textContent).toContain("Never verified");
  });

  it("null contact → 'unknown account' and the --empty modifier, never a blank cell", () => {
    const el = renderRecordCard(item({ contact_label: null }), { now: NOW });
    const contact = el.querySelector(".nk-record__contact");
    expect(contact.textContent).toBe("unknown account");
    expect(contact.className).toContain("nk-record__contact--empty");
  });

  it("missing contact_label field (real projection today) → 'unknown account'", () => {
    const bare = item();
    delete bare.contact_label;
    const el = renderRecordCard(bare, { now: NOW });
    expect(el.querySelector(".nk-record__contact").textContent).toBe("unknown account");
  });

  it("null platform_label → 'Unknown'", () => {
    const el = renderRecordCard(item({ platform_label: null }), { now: NOW });
    expect(el.querySelector(".nk-record__platform").textContent).toBe("Unknown");
  });

  it("click calls onSelect and dispatches a bubbling vault:select event", () => {
    const onSelect = vi.fn();
    const host = document.createElement("div");
    const el = renderRecordCard(item(), { onSelect, now: NOW });
    host.append(el);
    const heard = vi.fn();
    host.addEventListener("vault:select", heard);

    el.click();

    expect(onSelect).toHaveBeenCalledWith("NK-0007");
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard.mock.calls[0][0].detail).toEqual({ evidence_id: "NK-0007" });
  });

  it("renders no <img> — metadata only", () => {
    const el = renderRecordCard(item(), { now: NOW });
    expect(el.querySelectorAll("img")).toHaveLength(0);
  });
});
