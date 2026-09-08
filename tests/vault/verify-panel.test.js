// @vitest-environment jsdom
/**
 * EVOCK — verification panel (Role C, step 05 / C5, spec §18).
 */

import { describe, expect, it, vi } from "vitest";
import {
  createVerifyPanel,
  HONEST_FOOTER,
  renderVerifyPanel
} from "../../extension/src/vault/components/verify-panel.js";
import { loadUiFixture } from "../helpers/ui-fixtures.js";

const MANIFEST = loadUiFixture("record.sample").manifest;
const OK = loadUiFixture("verification.ok.sample");
const MODIFIED = loadUiFixture("verification.modified.sample");
const ERROR = loadUiFixture("verification.error.sample");

describe("renderVerifyPanel — VERIFIED", () => {
  it("shows INTEGRITY VERIFIED, four ✓, and the verified time", () => {
    const el = renderVerifyPanel(OK, { manifest: MANIFEST });
    expect(el.className).toContain("nk-verify--verified");
    expect(el.textContent).toContain("INTEGRITY VERIFIED");
    const checks = [...el.querySelectorAll(".nk-verify__check")];
    expect(checks).toHaveLength(4);
    expect(checks.every((c) => c.dataset.ok === "true")).toBe(true);
    expect(el.querySelector(".nk-verify__when").textContent).toContain("8 Sep 2026");
    expect(el.querySelector(".nk-verify__hashes")).toBeNull();
  });
});

describe("renderVerifyPanel — MODIFIED", () => {
  const el = renderVerifyPanel(MODIFIED, { manifest: MANIFEST });

  it("uses the red modified treatment and heading", () => {
    expect(el.className).toContain("nk-verify--modified");
    expect(el.className).not.toContain("nk-verify--error");
    expect(el.textContent).toContain("MODIFICATION DETECTED");
  });

  it("shows the recorded-vs-current hash pair, side by side and visually distinct", () => {
    const hashes = el.querySelector(".nk-verify__hashes");
    expect(hashes).not.toBeNull();
    const lines = [...hashes.querySelectorAll(".nk-verify__hash")];
    expect(lines).toHaveLength(2);
    expect(lines[0].querySelector(".nk-verify__hash-label").textContent).toBe("RECORDED HASH");
    expect(lines[1].querySelector(".nk-verify__hash-label").textContent).toBe("CURRENT HASH");
    // recorded ← manifest.integrity (first failing field is metadata)
    expect(lines[0].querySelector(".nk-verify__hash-val").textContent).toBe(
      MANIFEST.integrity.metadata_hash
    );
    // current ← result.current_integrity (never derived locally)
    expect(lines[1].querySelector(".nk-verify__hash-val").textContent).toBe(
      MODIFIED.current_integrity.metadata_hash
    );
    expect(lines[0].querySelector(".nk-verify__hash-val").textContent).not.toBe(
      lines[1].querySelector(".nk-verify__hash-val").textContent
    );
  });

  it("per-field row matches the booleans exactly", () => {
    const byLabel = {};
    for (const c of el.querySelectorAll(".nk-verify__check")) {
      byLabel[c.textContent.replace(/[✓❌\s]+$/, "").trim()] = c.dataset.ok;
    }
    expect(byLabel).toEqual({
      Screenshot: "true",
      Metadata: "false",
      Manifest: "false",
      Signature: "false"
    });
  });

  it("names the changed field, referencing the record's creation date", () => {
    expect(el.querySelector(".nk-verify__explain").textContent).toBe(
      "The AI-derived metadata does not match the record created on 1 Sep 2026."
    );
  });

  it("renders every details string verbatim", () => {
    const items = [...el.querySelectorAll(".nk-verify__details li")].map((li) => li.textContent);
    expect(items).toEqual(MODIFIED.details);
  });

  it("falls back to 'not reported by the verifier' when current_integrity is absent", () => {
    const noHashes = { ...MODIFIED };
    delete noHashes.current_integrity;
    const e = renderVerifyPanel(noHashes, { manifest: MANIFEST });
    const current = e.querySelectorAll(".nk-verify__hash")[1].querySelector(".nk-verify__hash-val");
    expect(current.textContent).toMatch(/not reported by the verifier/);
    expect(current.className).toContain("nk-verify__hash-val--missing");
  });
});

describe("renderVerifyPanel — ERROR", () => {
  const el = renderVerifyPanel(ERROR, { manifest: MANIFEST });

  it("uses a neutral treatment, not the red MODIFIED one", () => {
    expect(el.className).toContain("nk-verify--error");
    expect(el.className).not.toContain("nk-verify--modified");
    expect(el.textContent).toContain("could not complete");
    expect(el.textContent).not.toContain("MODIFICATION DETECTED");
  });

  it("shows the details verbatim and no hash pair", () => {
    expect([...el.querySelectorAll(".nk-verify__details li")].map((li) => li.textContent)).toEqual(
      ERROR.details
    );
    expect(el.querySelector(".nk-verify__hashes")).toBeNull();
  });
});

describe("honest footer + purity", () => {
  it("is present in all three states, verbatim", () => {
    for (const r of [OK, MODIFIED, ERROR]) {
      const el = renderVerifyPanel(r, { manifest: MANIFEST });
      expect(el.querySelector(".nk-verify__footer").textContent).toBe(HONEST_FOOTER);
    }
  });

  it("renders purely from its inputs — no crypto.subtle, deterministic", () => {
    const digest = vi.spyOn(crypto.subtle, "digest");
    const a = renderVerifyPanel(MODIFIED, { manifest: MANIFEST }).textContent;
    const b = renderVerifyPanel(MODIFIED, { manifest: MANIFEST }).textContent;
    expect(a).toBe(b);
    expect(digest).not.toHaveBeenCalled();
    digest.mockRestore();
  });
});

describe("createVerifyPanel", () => {
  it("runs the verify seam once and calls onResult with the result", async () => {
    const verifyApi = { verify: vi.fn(async () => MODIFIED) };
    const onResult = vi.fn();
    const panel = createVerifyPanel({ verifyApi, onResult });

    await panel.run("NK-0001", { manifest: MANIFEST });

    expect(verifyApi.verify).toHaveBeenCalledTimes(1);
    // No version passed -> undefined -> worker treats this as the latest,
    // persisted verification. Regression guard for the version-threading bug:
    // this must NOT silently default to some other value.
    expect(verifyApi.verify).toHaveBeenCalledWith("NK-0001", undefined);
    expect(onResult).toHaveBeenCalledWith("NK-0001", MODIFIED);
    expect(panel.element.hidden).toBe(false);
    expect(panel.element.querySelector(".nk-verify--modified")).not.toBeNull();
  });

  it("threads an explicit version through to the verify seam unchanged", async () => {
    const verifyApi = { verify: vi.fn(async () => MODIFIED) };
    const panel = createVerifyPanel({ verifyApi });

    // Selecting an older version in the detail panel and clicking Verify must
    // verify THAT version, not silently fall back to the latest — otherwise the
    // recorded hash (from the old manifest) is compared against a current hash
    // recomputed for a different version, which reports a correctly-signed old
    // version as MODIFIED for no reason.
    await panel.run("NK-0001", { manifest: MANIFEST, version: 1 });

    expect(verifyApi.verify).toHaveBeenCalledWith("NK-0001", 1);
  });

  it("shows a transport error and does NOT call onResult when the seam rejects", async () => {
    const verifyApi = { verify: vi.fn(async () => Promise.reject(new Error("bridge down"))) };
    const onResult = vi.fn();
    const panel = createVerifyPanel({ verifyApi, onResult });

    await panel.run("NK-0001", {});

    expect(panel.element.querySelector(".nk-verify__run-error").textContent).toMatch(/bridge down/);
    expect(onResult).not.toHaveBeenCalled();
  });

  it("close() empties and hides the host", async () => {
    const panel = createVerifyPanel({ verifyApi: { verify: async () => OK } });
    await panel.run("NK-0001", { manifest: MANIFEST });
    panel.close();
    expect(panel.element.hidden).toBe(true);
    expect(panel.element.childElementCount).toBe(0);
  });
});
