/**
 * EVOCK — end-to-end pipeline integration test (Role C, step 08 / C8, Task 1).
 *
 * Drives the whole product path from the outside, against fixtures, with no real
 * browser — `fake-indexeddb` (via tests/setup.js) stands in for the vault:
 *
 *   lock → store → list → open detail → verify ✓
 *        → tamper → verify ❌ → restore → verify ✓
 *        → export PDF + ZIP
 *        → verify the exported ZIP from an EMPTY vault, using only its contents
 *          and the recipe in its README.txt
 *
 * If the last step fails, the exported package is decorative — it has to stand
 * on its own on a machine that has never seen this vault.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import JSZip from "jszip";

import { lockEvidence } from "../../extension/src/evidence/lock-evidence.js";
import { reduceManifestForHashing } from "../../extension/src/evidence/manifest-builder.js";
import { canonicalize } from "../../extension/src/evidence/canonicalize.js";
import { VERIFY_DETAILS, verifyEvidence } from "../../extension/src/verify/verifier.js";
import { __tamperDemo } from "../../extension/src/verify/tamper-demo.js";
import * as vaultRepo from "../../extension/src/storage/vault-repo.js";
import {
  closeDb,
  DB_NAME,
  openDb,
  STORE_EVIDENCE,
  STORE_SETTINGS,
  txDone
} from "../../extension/src/storage/db.js";
import {
  base64ToBytes,
  bytesToBase64,
  sha256Bytes,
  sha256Canonical,
  sha256Utf8
} from "../../extension/src/crypto/hash.js";
import { decryptBlob, getVaultKey } from "../../extension/src/crypto/encrypt.js";
import { verifyManifestSignature } from "../../extension/src/crypto/sign.js";
import { buildPdfReport } from "../../extension/src/export/pdf-report.js";
import { buildPackageZip } from "../../extension/src/export/package-zip.js";
import { loadFixture } from "../helpers/fixtures.js";

async function resetVault() {
  await closeDb();
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

/** Empty the evidence + settings stores but KEEP the vault key (STORE_KEYS). */
async function clearEvidenceKeepKey() {
  const db = await openDb();
  const tx = db.transaction([STORE_EVIDENCE, STORE_SETTINGS], "readwrite");
  tx.objectStore(STORE_EVIDENCE).clear();
  tx.objectStore(STORE_SETTINGS).clear();
  await txDone(tx);
}

const capture = () => loadFixture("capture.sample");
const extractionOk = () => loadFixture("extraction.ok.sample");

async function screenshotDataUrl(id) {
  const blob = await vaultRepo.getDecryptedScreenshot(id);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return `data:${blob.type || "image/png"};base64,${bytesToBase64(bytes)}`;
}

beforeEach(resetVault);
afterEach(async () => {
  globalThis.__EVOCK_DEV__ = true;
  await resetVault();
});

describe("integration — lock → list → detail → verify → tamper → restore → export", () => {
  it("runs the whole path and produces sound exports", async () => {
    // --- lock + store ---------------------------------------------------
    const stored = await lockEvidence({ capture: capture(), extraction: extractionOk() });
    const id = stored.evidence_id;
    expect(id).toMatch(/^NK-/);

    // --- list: metadata only, no ciphertext --------------------------
    const items = await vaultRepo.list();
    expect(items).toHaveLength(1);
    expect(items[0].evidence_id).toBe(id);
    expect(items[0]).not.toHaveProperty("screenshot_ciphertext");
    expect(items[0]).not.toHaveProperty("iv");
    expect(items[0]).not.toHaveProperty("manifest");

    // --- open detail: decrypts to a real PNG -----------------------
    const blob = await vaultRepo.getDecryptedScreenshot(id);
    const pngBytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(pngBytes.slice(0, 4))).toEqual([137, 80, 78, 71]); // PNG magic

    // --- verify: VERIFIED ----------------------------------------
    const first = await verifyEvidence(id, { persist: true });
    expect(first.status).toBe("VERIFIED");
    expect(first.screenshot_hash_ok && first.metadata_hash_ok).toBe(true);
    expect(first.manifest_hash_ok && first.signature_ok).toBe(true);

    // --- tamper: MODIFIED with the metadata mismatch -----------
    await __tamperDemo(id, "modify_metadata");
    const tampered = await verifyEvidence(id, { persist: true });
    expect(tampered.status).toBe("MODIFIED");
    expect(tampered.details).toContain(VERIFY_DETAILS.METADATA_MISMATCH);
    expect(tampered.screenshot_hash_ok).toBe(true);
    // the timeline pill would now read "modified"
    expect((await vaultRepo.get(id)).last_verification.status).toBe("MODIFIED");

    // --- restore: VERIFIED again -------------------------------
    await __tamperDemo(id, "restore");
    const restored = await verifyEvidence(id, { persist: true });
    expect(restored.status).toBe("VERIFIED");

    // --- export: PDF + ZIP -----------------------------------
    const record = await vaultRepo.get(id);
    const verification = restored;

    const { bytes: pdfBytes } = buildPdfReport(
      { record, verification, screenshotDataUrl: await screenshotDataUrl(id) },
      { jsPDF }
    );
    expect(new TextDecoder().decode(pdfBytes.slice(0, 5))).toBe("%PDF-");
    expect(pdfBytes.byteLength).toBeGreaterThan(1000);

    const zipBytes = await buildPackageZip({ record, verification }, { JSZip });
    expect(String.fromCharCode(zipBytes[0], zipBytes[1])).toBe("PK");
    expect(zipBytes.byteLength).toBeGreaterThan(300);

    const zip = await JSZip.loadAsync(zipBytes);
    const entries = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    expect(entries.sort()).toEqual(
      [
        `${id}/README.txt`,
        `${id}/manifest.json`,
        `${id}/public-key.jwk`,
        `${id}/screenshot.enc`,
        `${id}/signature.sig`,
        `${id}/verification.json`
      ].sort()
    );
    const manifestJson = await zip.file(`${id}/manifest.json`).async("string");
    expect(manifestJson).toBe(canonicalize(reduceManifestForHashing(record.manifest)));
  });
});

describe("integration — the exported ZIP verifies from an empty vault", () => {
  it("reproduces every hash and the signature from package contents + README recipe", async () => {
    // Produce a package, then wipe the evidence vault (keep only the AES key,
    // which the README says the screenshot hash needs).
    const stored = await lockEvidence({ capture: capture(), extraction: extractionOk() });
    const id = stored.evidence_id;
    const verification = await verifyEvidence(id, { persist: true });
    const recordBefore = await vaultRepo.get(id);
    // The one value the package does NOT carry: manifest_hash is deleted from
    // manifest.json (it cannot contain a hash of itself) and the signature pins
    // it instead. Keep the vault's copy only to cross-check what we recompute.
    const vaultManifestHash = recordBefore.manifest.integrity.manifest_hash;
    const zipBytes = await buildPackageZip({ record: recordBefore, verification }, { JSZip });

    await clearEvidenceKeepKey();
    expect(await vaultRepo.list()).toHaveLength(0); // vault is empty
    expect(await vaultRepo.get(id)).toBeUndefined();

    // From here on: ONLY the bytes inside the zip.
    const zip = await JSZip.loadAsync(zipBytes);
    const manifestText = await zip.file(`${id}/manifest.json`).async("string");
    const manifest = JSON.parse(manifestText);
    const sigB64 = await zip.file(`${id}/signature.sig`).async("string");
    const jwk = JSON.parse(await zip.file(`${id}/public-key.jwk`).async("string"));
    const encBytes = new Uint8Array(await zip.file(`${id}/screenshot.enc`).async("arraybuffer"));
    const verificationJson = JSON.parse(await zip.file(`${id}/verification.json`).async("string"));

    // README line 3: manifest.json is already the reduced canonical form (no
    // .signature, no .integrity.manifest_hash), so its bytes hash straight to
    // manifest_hash. Recompute it two ways and cross-check against the vault.
    const manifestHash = await sha256Utf8(manifestText);
    expect(manifestHash).toBe(await sha256Canonical(reduceManifestForHashing(manifest)));
    expect(manifestHash).toBe(vaultManifestHash);
    expect(manifest.integrity).not.toHaveProperty("manifest_hash");
    expect(manifest).not.toHaveProperty("signature");

    // README line 2: metadata_hash over canonical ai_derived_metadata.
    expect(await sha256Canonical(manifest.ai_derived_metadata)).toBe(
      manifest.integrity.metadata_hash
    );

    // README line 4: ECDSA-P256 over the recomputed manifest_hash bytes, checked
    // with the embedded public key — this is what pins manifest.json.
    expect(await verifyManifestSignature(manifestHash, sigB64, jwk)).toBe(true);
    // a one-character change to the signed hash must break it
    const flippedHash = manifestHash.slice(0, -1) + (manifestHash.endsWith("0") ? "1" : "0");
    expect(await verifyManifestSignature(flippedHash, sigB64, jwk)).toBe(false);

    // README line 1: screenshot_hash over the DECRYPTED bytes (needs the AES key,
    // per the KEY HANDLING note — not shipped in the package).
    const iv = base64ToBytes(manifest.visual_artifact.encryption.iv);
    const plaintext = await decryptBlob(encBytes.buffer, iv, await getVaultKey());
    expect(await sha256Bytes(new Uint8Array(plaintext))).toBe(manifest.integrity.screenshot_hash);

    // verification.json round-trips.
    expect(verificationJson.status).toBe("VERIFIED");
  });
});
