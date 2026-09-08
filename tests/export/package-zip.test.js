/**
 * EVOCK — machine-readable evidence package (Role C, step 07 / C6).
 *
 * The archive must contain all six entries, and `manifest.json` must be
 * byte-identical to what the vault hashed (`canonicalize(reduceManifestForHashing(...))`)
 * so a third party's `sha256(manifest.json)` reproduces `integrity.manifest_hash`.
 */

import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildPackageZip, packageZipFilename } from "../../extension/src/export/package-zip.js";
import { HASHING_RECIPE } from "../../extension/src/export/verify-readme.txt.js";
import { canonicalize } from "../../extension/src/evidence/canonicalize.js";
import { reduceManifestForHashing } from "../../extension/src/evidence/index.js";
import { loadUiFixture } from "../helpers/ui-fixtures.js";
import { dataUrlToBytesForTest } from "../helpers/fixtures.js";

const RECORD = loadUiFixture("record.sample.json");
const VERIFICATION_OK = loadUiFixture("verification.ok.sample.json");
const ID = RECORD.evidence_id; // "NK-0001"

async function open(record = RECORD, verification = VERIFICATION_OK) {
  const bytes = await buildPackageZip({ record, verification }, { JSZip });
  return { bytes, zip: await JSZip.loadAsync(bytes) };
}

describe("buildPackageZip", () => {
  it("returns real .zip bytes", async () => {
    const { bytes } = await open();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
  });

  it("contains all six entries under NK-0001/", async () => {
    const { zip } = await open();
    const names = Object.keys(zip.files)
      .filter((n) => !zip.files[n].dir)
      .sort();
    expect(names).toEqual(
      [
        `${ID}/README.txt`,
        `${ID}/manifest.json`,
        `${ID}/public-key.jwk`,
        `${ID}/screenshot.enc`,
        `${ID}/signature.sig`,
        `${ID}/verification.json`
      ].sort()
    );
  });

  it("manifest.json is byte-identical to canonicalize(reduceManifestForHashing(manifest))", async () => {
    const { zip } = await open();
    const got = await zip.file(`${ID}/manifest.json`).async("string");
    expect(got).toBe(canonicalize(reduceManifestForHashing(RECORD.manifest)));
    // and it is a strict subset of the stored manifest — no signature, no manifest_hash
    const parsed = JSON.parse(got);
    expect(parsed.signature).toBeUndefined();
    expect(parsed.integrity.manifest_hash).toBeUndefined();
    expect(parsed.integrity.screenshot_hash).toBe(RECORD.manifest.integrity.screenshot_hash);
  });

  it("screenshot.enc holds the raw ciphertext bytes", async () => {
    const { zip } = await open();
    const got = new Uint8Array(await zip.file(`${ID}/screenshot.enc`).async("arraybuffer"));
    expect([...got]).toEqual([...dataUrlToBytesForTest(RECORD.screenshot_ciphertext)]);
  });

  it("signature.sig is the base64 signature; public-key.jwk parses to the manifest key", async () => {
    const { zip } = await open();
    expect(await zip.file(`${ID}/signature.sig`).async("string")).toBe(
      RECORD.manifest.signature.signature
    );
    expect(JSON.parse(await zip.file(`${ID}/public-key.jwk`).async("string"))).toEqual(
      RECORD.manifest.signature.public_key_jwk
    );
  });

  it("verification.json parses back to the injected VerificationResult", async () => {
    const { zip } = await open();
    expect(JSON.parse(await zip.file(`${ID}/verification.json`).async("string"))).toEqual(
      VERIFICATION_OK
    );
  });

  it("verification.json is null when no result is passed", async () => {
    const { zip } = await open(RECORD, null);
    expect(await zip.file(`${ID}/verification.json`).async("string")).toBe("null\n");
  });

  it("README.txt contains the four hashing lines verbatim", async () => {
    const { zip } = await open();
    const readme = await zip.file(`${ID}/README.txt`).async("string");
    for (const line of HASHING_RECIPE) expect(readme).toContain(line);
  });

  it("filename follows EVOCK-<id>-package.zip", () => {
    expect(packageZipFilename("NK-0003")).toBe("EVOCK-NK-0003-package.zip");
  });

  it("throws without a JSZip or a manifest", async () => {
    await expect(buildPackageZip({ record: RECORD }, { JSZip: null })).rejects.toThrow(/JSZip/);
    await expect(buildPackageZip({ record: {} }, { JSZip })).rejects.toThrow(/manifest/);
  });
});
