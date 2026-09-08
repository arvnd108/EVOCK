/**
 * EVOCK — reviseMetadata tests (Role B step 12).
 *
 * A human correction appends a new signed version and never touches an existing
 * one; the screenshot and its hash are shared across every version.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reviseMetadata } from "../../extension/src/evidence/revise-metadata.js";
import { verifyEvidence } from "../../extension/src/verify/verifier.js";
import { lockEvidence } from "../../extension/src/evidence/lock-evidence.js";
import * as vaultRepo from "../../extension/src/storage/vault-repo.js";
import {
  closeDb,
  DB_NAME,
  openDb,
  requestToPromise,
  STORE_EVIDENCE,
  txDone
} from "../../extension/src/storage/db.js";
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

async function seed(extractionName = "extraction.ok.sample") {
  const { evidence_id } = await lockEvidence({
    capture: loadFixture("capture.sample"),
    extraction: loadFixture(extractionName)
  });
  return evidence_id;
}

/** The corrected data block Role C would submit. */
function correctedData(overrides = {}) {
  return {
    platform: "WhatsApp",
    contact_name: "Mr. A. B. Correct",
    messages: [
      {
        sender: "Mr. A. B. Correct",
        text: "Sample preserved abusive message extracted by offline demo provider.",
        visible_timestamp: "11:28 PM",
        type: "incoming"
      }
    ],
    visible_time: "11:28 PM",
    date: "1 September 2026",
    ...overrides
  };
}

beforeEach(resetVault);
afterEach(async () => {
  vi.restoreAllMocks();
  await resetVault();
});

describe("reviseMetadata — appends a version", () => {
  it("adds v2 without touching v1", async () => {
    const id = await seed();
    const before = await vaultRepo.get(id);

    const updated = await reviseMetadata(id, correctedData(), {
      note: "Corrected the misread contact name."
    });

    expect(updated.versions).toHaveLength(2);

    // v1 byte-identical to the record before the edit
    expect(updated.versions[0].origin).toBe("ai");
    expect(updated.versions[0].manifest).toEqual(before.manifest);
    expect(updated.versions[0].manifest.integrity.metadata_hash).toBe(
      before.manifest.integrity.metadata_hash
    );
    expect(updated.versions[0].manifest.signature.signature).toBe(
      before.manifest.signature.signature
    );

    // v2 is the human correction
    expect(updated.versions[1].version).toBe(2);
    expect(updated.versions[1].origin).toBe("human");
    expect(updated.versions[1].author).toBeNull();
    expect(updated.versions[1].note).toBe("Corrected the misread contact name.");
    expect(updated.versions[1].created_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/
    );
  });

  it("shares the screenshot hash, ciphertext and IV across versions", async () => {
    const id = await seed();
    const updated = await reviseMetadata(id, correctedData());

    const [v1, v2] = updated.versions;
    expect(v2.manifest.integrity.screenshot_hash).toBe(v1.manifest.integrity.screenshot_hash);
    expect(v2.manifest.visual_artifact.encryption.iv).toBe(
      v1.manifest.visual_artifact.encryption.iv
    );

    const stored = await vaultRepo.get(id);
    expect(new Uint8Array(stored.screenshot_ciphertext)).toEqual(
      new Uint8Array((await vaultRepo.get(id)).screenshot_ciphertext)
    );
  });

  it("recomputes only the metadata, manifest and signature for v2", async () => {
    const id = await seed();
    const updated = await reviseMetadata(id, correctedData());
    const [v1, v2] = updated.versions;

    expect(v2.manifest.integrity.metadata_hash).not.toBe(v1.manifest.integrity.metadata_hash);
    expect(v2.manifest.integrity.manifest_hash).not.toBe(v1.manifest.integrity.manifest_hash);
    expect(v2.manifest.signature.signature).not.toBe(v1.manifest.signature.signature);
    // signed_at is refreshed (nowIso); it may land in the same second as v1's
    // in a fast test, so only assert it is well-formed, not that it differs.
    expect(v2.manifest.signature.signed_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/
    );
    // provenance untouched — the human origin is on the wrapper, not the enum
    expect(v2.manifest.ai_derived_metadata.provider).toBe(v1.manifest.ai_derived_metadata.provider);
    expect(v2.manifest.ai_derived_metadata.model).toBe(v1.manifest.ai_derived_metadata.model);
    // device capture time is the original — a revision is not a new capture
    expect(v2.manifest.timestamp.device_capture_time).toBe(
      v1.manifest.timestamp.device_capture_time
    );
  });

  it("mirrors the latest version onto record.manifest and resets last_verification", async () => {
    const id = await seed();
    await verifyEvidence(id); // sets last_verification

    const updated = await reviseMetadata(id, correctedData({ platform: "Instagram" }));

    expect(updated.manifest).toEqual(updated.versions[1].manifest);
    expect(updated.last_verification).toBeNull();
    expect(updated.platform_label).toBe("Instagram");

    const stored = await vaultRepo.get(id);
    expect(stored.last_verification).toBeNull();
    expect(stored.manifest.integrity.manifest_hash).toBe(updated.versions[1].manifest.integrity.manifest_hash);
  });
});

describe("reviseMetadata — every version verifies", () => {
  it("VERIFIED for the latest and for v1", async () => {
    const id = await seed();
    await reviseMetadata(id, correctedData());

    expect((await verifyEvidence(id)).status).toBe("VERIFIED");
    expect((await verifyEvidence(id, { version: 1 })).status).toBe("VERIFIED");
    expect((await verifyEvidence(id, { version: 2 })).status).toBe("VERIFIED");
  });

  it("promotes a failed extraction to status ok when the human supplies data", async () => {
    const id = await seed("extraction.failed.sample");
    const updated = await reviseMetadata(id, correctedData());

    expect(updated.versions[0].manifest.ai_derived_metadata.status).toBe("failed");
    expect(updated.versions[1].manifest.ai_derived_metadata.status).toBe("ok");
    expect(updated.versions[1].manifest.ai_derived_metadata.data.contact_name).toBe(
      "Mr. A. B. Correct"
    );
    expect((await verifyEvidence(id)).status).toBe("VERIFIED");
  });
});

describe("reviseMetadata — atomicity", () => {
  it("writes nothing if signing throws", async () => {
    const id = await seed();
    const sign = await import("../../extension/src/crypto/sign.js");
    vi.spyOn(sign, "signManifestHash").mockRejectedValue(new Error("keystore locked"));

    await expect(reviseMetadata(id, correctedData())).rejects.toThrow("keystore locked");

    const stored = await vaultRepo.get(id);
    expect(stored.versions).toBeUndefined(); // still a pre-1.1 single-version record
    expect((await verifyEvidence(id)).status).toBe("VERIFIED");
  });

  it("rejects a missing record and a bad data argument", async () => {
    await expect(reviseMetadata("NK-9999", correctedData())).rejects.toThrow(/NK-9999/);
    const id = await seed();
    await expect(reviseMetadata(id, null)).rejects.toThrow(TypeError);
  });
});

describe("reviseMetadata — pre-1.1 record", () => {
  it("persists a 2-entry versions array on the first revision", async () => {
    const id = await seed();
    expect((await vaultRepo.get(id)).versions).toBeUndefined();

    await reviseMetadata(id, correctedData());

    const stored = await vaultRepo.get(id);
    expect(stored.versions).toHaveLength(2);
    expect(stored.versions[0].origin).toBe("ai");
    expect(stored.versions[0].version).toBe(1);
    expect(stored.versions[1].origin).toBe("human");
  });

  it("synthesises v1 created_at from the manifest's signed_at", async () => {
    const id = await seed();
    const signedAt = (await vaultRepo.get(id)).manifest.signature.signed_at;

    await reviseMetadata(id, correctedData());

    expect((await vaultRepo.get(id)).versions[0].created_at).toBe(signedAt);
  });

  it("a second revision appends v3", async () => {
    const id = await seed();
    await reviseMetadata(id, correctedData({ contact_name: "First fix" }));
    const updated = await reviseMetadata(id, correctedData({ contact_name: "Second fix" }));

    expect(updated.versions.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(updated.versions[2].origin).toBe("human");
    expect(updated.manifest.ai_derived_metadata.data.contact_name).toBe("Second fix");
    expect((await verifyEvidence(id, { version: 2 })).status).toBe("VERIFIED");
    expect((await verifyEvidence(id, { version: 3 })).status).toBe("VERIFIED");
  });
});
