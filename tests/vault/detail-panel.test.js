// @vitest-environment jsdom
/**
 * EVOCK — evidence detail panel + its blocks (Role C, step 04 / C3 part 2).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDetailPanel,
  formatDeviceTime
} from "../../extension/src/vault/components/detail-panel.js";
import { renderDerivedMetadataBlock } from "../../extension/src/vault/components/derived-metadata-block.js";
import { renderIntegrityBlock } from "../../extension/src/vault/components/integrity-block.js";
import { loadUiFixture } from "../helpers/ui-fixtures.js";

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==";

let objectUrlSeq = 0;

beforeEach(() => {
  objectUrlSeq = 0;
  URL.createObjectURL = vi.fn(() => `blob:mock-${++objectUrlSeq}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete URL.createObjectURL;
  delete URL.revokeObjectURL;
});

function apiFor(fixtureName) {
  const rec = loadUiFixture(fixtureName);
  return {
    get: vi.fn(async () => ({
      manifest: rec.manifest,
      created_at: rec.created_at,
      platform_label: rec.platform_label,
      last_verification: rec.last_verification,
      versions: rec.versions,
      screenshotDataUrl: PNG_DATA_URL
    }))
  };
}

describe("formatDeviceTime", () => {
  it("renders the ISO instant with its offset, locale-independently", () => {
    expect(formatDeviceTime("2026-09-01T23:31:14+05:30")).toBe("1 Sep 2026, 23:31:14 +05:30");
  });
  it("degrades rather than throwing on junk", () => {
    expect(formatDeviceTime("nonsense")).toBe("nonsense");
  });
});

describe("detail panel — full record", () => {
  it("renders every section from record.sample", async () => {
    const api = apiFor("record.sample");
    const panel = createDetailPanel({ detailApi: api });
    await panel.show("NK-0001");
    const el = panel.element;

    expect(el.hidden).toBe(false);
    expect(el.querySelector(".nk-detail__id").textContent).toBe("NK-0001");

    const img = el.querySelector("img.nk-detail__screenshot");
    expect(img.getAttribute("src")).toBe("blob:mock-1");
    expect(img.alt).toContain("NK-0001");

    // AI-derived block
    const derived = el.querySelector(".nk-derived");
    expect(derived).not.toBeNull();
    expect(derived.querySelector(".nk-derived__label").textContent).toContain(
      "AI-derived metadata"
    );
    expect(derived.querySelector(".nk-derived__note").textContent).toMatch(/misread/i);
    expect(derived.textContent).toContain("WhatsApp");
    expect(derived.textContent).toContain("Mr. ABC B");
    expect(derived.textContent).toContain("11:28 PM");
    expect(derived.textContent).toContain("1 September 2026");

    // Capture context
    expect(el.textContent).toContain("web.whatsapp.com");

    // Integrity
    expect(el.querySelectorAll(".nk-integrity__row").length).toBeGreaterThanOrEqual(6);
    expect(el.querySelectorAll(".nk-copy")).toHaveLength(3);
    expect(el.textContent).toContain("✓ ECDSA P-256");
    expect(el.textContent).toContain("✓ AES-GCM 256");
  });

  it("Device time and Trusted timestamp are two separate, honestly labelled rows", async () => {
    const panel = createDetailPanel({ detailApi: apiFor("record.sample") });
    await panel.show("NK-0001");
    const el = panel.element;

    const kvKeys = [...el.querySelectorAll(".nk-kv__key")].map((n) => n.textContent);
    const integKeys = [...el.querySelectorAll(".nk-integrity__key")].map((n) => n.textContent);

    expect(kvKeys).toContain("Device time");
    expect(kvKeys).not.toContain("Trusted timestamp");
    expect(integKeys).toContain("Trusted timestamp");
    expect(integKeys).not.toContain("Device time");

    const tsRow = [...el.querySelectorAll(".nk-integrity__row")].find(
      (r) => r.querySelector(".nk-integrity__key")?.textContent === "Trusted timestamp"
    );
    expect(tsRow.querySelector(".nk-integrity__val").textContent).toBe("Not configured");
  });
});

describe("detail panel — versioned record — Verify button passes the selected version", () => {
  // Regression guard: selecting an OLDER version in the history list and
  // clicking Verify must tell the worker which version, or the panel ends up
  // comparing a recorded hash from the old manifest against a current hash
  // recomputed for the latest — reporting a correctly-signed old version as
  // MODIFIED. Viewing the LATEST version must omit it (undefined), so the
  // worker still treats the run as the record's current, persisted state.
  it("omits version when viewing the latest version", async () => {
    const onVerify = vi.fn();
    const panel = createDetailPanel({ detailApi: apiFor("record.versioned.sample"), onVerify });
    await panel.show("NK-0001"); // defaults to the latest (v2)

    panel.element.querySelector(".nk-detail__actions button").click(); // "Verify" is first

    expect(onVerify).toHaveBeenCalledTimes(1);
    const [id, manifest, version] = onVerify.mock.calls[0];
    expect(id).toBe("NK-0001");
    expect(manifest).toBeTruthy();
    expect(version).toBeUndefined();
  });

  it("passes the 1-based version number when an older version is selected", async () => {
    const onVerify = vi.fn();
    const panel = createDetailPanel({ detailApi: apiFor("record.versioned.sample"), onVerify });
    await panel.show("NK-0001");

    // Select v1 from the version history, then click Verify.
    const v1Row = [...panel.element.querySelectorAll(".nk-versions__row")].find(
      (row) => row.dataset.version === "1"
    );
    expect(v1Row).toBeTruthy();
    v1Row.click();

    panel.element.querySelector(".nk-detail__actions button").click();

    expect(onVerify).toHaveBeenCalledTimes(1);
    const [id, manifest, version] = onVerify.mock.calls[0];
    expect(id).toBe("NK-0001");
    expect(version).toBe(1);
    // The recorded hash the verify panel will show must come from v1's own
    // manifest, not the latest's.
    const v1Manifest = loadUiFixture("record.versioned.sample").versions[0].manifest;
    expect(manifest.integrity.metadata_hash).toBe(v1Manifest.integrity.metadata_hash);
  });
});

describe("detail panel — failed extraction", () => {
  it("shows a calm missing-metadata state, integrity intact, no 'failed capture' language", async () => {
    const panel = createDetailPanel({ detailApi: apiFor("record.failed-extraction.sample") });
    await panel.show("NK-0002");
    const el = panel.element;

    expect(el.querySelector(".nk-derived__unavailable").textContent).toMatch(
      /AI extraction unavailable/i
    );
    expect(el.textContent).not.toMatch(/failed capture|capture failed/i);

    // integrity intact
    expect(el.querySelectorAll(".nk-copy")).toHaveLength(3);
    expect(el.textContent).toContain("✓ ECDSA P-256");
    expect(el.textContent).toContain("✓ AES-GCM 256");
    expect(el.querySelector("img.nk-detail__screenshot")).not.toBeNull();
  });
});

describe("detail panel — null fields", () => {
  it("renders Unknown / unknown account / 'No message text extracted' with no blank cell", async () => {
    const panel = createDetailPanel({ detailApi: apiFor("record.null-fields.sample") });
    await panel.show("NK-0003");
    const el = panel.element;

    const derived = el.querySelector(".nk-derived");
    expect(derived.textContent).toContain("Unknown");
    expect(derived.textContent).toContain("unknown account");
    expect(derived.textContent).toContain("No message text extracted");

    for (const val of el.querySelectorAll(".nk-kv__val")) {
      expect(val.textContent.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("detail panel — memory hygiene", () => {
  it("creates one object URL on show and revokes it on close", async () => {
    const panel = createDetailPanel({ detailApi: apiFor("record.sample") });
    await panel.show("NK-0001");
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    panel.close();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
    expect(panel.element.hidden).toBe(true);
    expect(panel.element.childElementCount).toBe(0);
  });

  it("revokes the previous image before showing another record", async () => {
    const panel = createDetailPanel({ detailApi: apiFor("record.sample") });
    await panel.show("NK-0001");
    await panel.show("NK-0001");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
    expect(panel.element.querySelector("img").getAttribute("src")).toBe("blob:mock-2");
  });

  it("leaks nothing across 20 open/close cycles", async () => {
    const panel = createDetailPanel({ detailApi: apiFor("record.sample") });
    for (let i = 0; i < 20; i++) {
      await panel.show("NK-0001");
      panel.close();
    }
    expect(URL.createObjectURL).toHaveBeenCalledTimes(20);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(20);
    // every revoke matched a create return value
    const created = URL.createObjectURL.mock.results.map((r) => r.value);
    const revoked = URL.revokeObjectURL.mock.calls.map((c) => c[0]);
    expect(new Set(revoked)).toEqual(new Set(created));
  });
});

describe("integrity block — hashes never leak", () => {
  const manifest = loadUiFixture("record.sample").manifest;

  it("truncates the visible hash, keeps the full value only in title + clipboard", () => {
    const onCopy = vi.fn();
    const el = renderIntegrityBlock(manifest, { onCopy });

    const first = el.querySelector(".nk-integrity__val");
    expect(first.textContent).toMatch(/…$/);
    expect(first.textContent.length).toBeLessThan(manifest.integrity.screenshot_hash.length);
    expect(first.title).toBe(manifest.integrity.screenshot_hash);

    el.querySelector(".nk-copy").click();
    expect(onCopy).toHaveBeenCalledWith("Screenshot hash", manifest.integrity.screenshot_hash);
  });

  it("no hash value reaches console.* or an href/src", () => {
    const spies = ["log", "info", "warn", "error", "debug"].map((k) =>
      vi.spyOn(console, k).mockImplementation(() => {})
    );
    const el = renderIntegrityBlock(manifest);
    el.querySelectorAll(".nk-copy").forEach((b) => b.click());

    const hashes = [
      manifest.integrity.screenshot_hash,
      manifest.integrity.metadata_hash,
      manifest.integrity.manifest_hash
    ];
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        const line = call.join(" ");
        for (const h of hashes) expect(line).not.toContain(h);
      }
    }
    for (const node of el.querySelectorAll("a, img")) {
      const url = node.getAttribute("href") || node.getAttribute("src") || "";
      for (const h of hashes) expect(url).not.toContain(h);
    }
  });
});

describe("derived-metadata block", () => {
  it("is a tinted, always-labelled panel with an info affordance", () => {
    const el = renderDerivedMetadataBlock(
      loadUiFixture("record.sample").manifest.ai_derived_metadata
    );
    expect(el.className).toContain("nk-derived");
    expect(el.querySelector(".nk-derived__label").textContent).toContain("AI-derived metadata");
    const info = el.querySelector(".nk-derived__info");
    expect(info).not.toBeNull();
    expect(info.title).toMatch(/misread/i);
  });

  it("failed extraction → calm unavailable message, no data rows", () => {
    const el = renderDerivedMetadataBlock({
      provider: "vision",
      model: null,
      status: "failed",
      extracted_at: null,
      data: null
    });
    expect(el.querySelector(".nk-derived__unavailable")).not.toBeNull();
    expect(el.querySelector(".nk-kv")).toBeNull();
    expect(el.textContent).not.toMatch(/failed capture|capture failed/i);
  });

  it("shows an Incoming/Outgoing direction beside every message", () => {
    const meta = loadUiFixture("record.sample").manifest.ai_derived_metadata;
    const messages = meta.data.messages;
    expect(messages.length).toBeGreaterThan(0);

    const el = renderDerivedMetadataBlock(meta);
    const tags = [...el.querySelectorAll(".nk-msg__dir")];
    expect(tags).toHaveLength(messages.length);
    tags.forEach((tag, i) => {
      const t = messages[i].type;
      const want = t === "outgoing" ? "Outgoing" : t === "incoming" ? "Incoming" : "Unknown";
      expect(tag.textContent).toBe(want);
    });
  });

  it("falls back to 'Unknown' when a message has no type", () => {
    const meta = loadUiFixture("record.sample").manifest.ai_derived_metadata;
    const clone = JSON.parse(JSON.stringify(meta));
    clone.data.messages = [{ sender: "A", text: "hi", visible_timestamp: null, type: undefined }];
    const el = renderDerivedMetadataBlock(clone);
    expect(el.querySelector(".nk-msg__dir").textContent).toBe("Unknown");
  });
});
