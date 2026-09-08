/**
 * EVOCK — exported package README (Role C, step 07 / C6).
 *
 * The README is what makes the ZIP genuinely useful: it must carry the exact
 * hashing order from Building Plan §5.3 verbatim, and it must not overstate what
 * the package is (spec §36).
 */

import { describe, expect, it } from "vitest";
import { buildVerifyReadme, HASHING_RECIPE } from "../../extension/src/export/verify-readme.txt.js";

describe("buildVerifyReadme", () => {
  const readme = buildVerifyReadme({ evidence_id: "NK-0003" });

  it("names the record and ends with a newline", () => {
    expect(readme).toContain("EVOCK evidence package — NK-0003");
    expect(readme.endsWith("\n")).toBe(true);
  });

  it("contains all four hashing-recipe lines verbatim", () => {
    for (const line of HASHING_RECIPE) {
      expect(readme).toContain(line);
    }
  });

  it("spells out the four package files an investigator needs", () => {
    for (const f of [
      "manifest.json",
      "screenshot.enc",
      "signature.sig",
      "public-key.jwk",
      "verification.json"
    ]) {
      expect(readme).toContain(f);
    }
  });

  it("states plainly that the decryption key is not in the package", () => {
    expect(readme).toMatch(/key that decrypts screenshot\.enc is NOT included/i);
  });

  it("has no limitations / 'cannot establish' section", () => {
    expect(readme).not.toMatch(/WHAT THIS PACKAGE CANNOT ESTABLISH/i);
    expect(readme).not.toMatch(/does not replace professional forensic/i);
    expect(readme).not.toMatch(/legal admissibility/i);
    expect(readme.trimEnd().endsWith("ask the person who exported this package.")).toBe(true);
  });

  it("defaults the id when none is given", () => {
    expect(buildVerifyReadme()).toContain("NK-XXXX");
  });
});
