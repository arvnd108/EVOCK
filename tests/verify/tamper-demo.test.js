/**
 * EVOCK — tamper-demo harness tests (Role B step 09, B8).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __tamperDemo } from "../../extension/src/verify/tamper-demo.js";
import { VERIFY_DETAILS, verifyEvidence } from "../../extension/src/verify/verifier.js";
import { lockEvidence } from "../../extension/src/evidence/lock-evidence.js";
import {
  closeDb,
  DB_NAME,
  openDb,
  requestToPromise,
  STORE_EVIDENCE,
  STORE_SETTINGS
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

async function rawRecord(id) {
  const db = await openDb();
  return requestToPromise(
    db.transaction(STORE_EVIDENCE, "readonly").objectStore(STORE_EVIDENCE).get(id)
  );
}

async function backupRow(id) {
  const db = await openDb();
  return requestToPromise(
    db
      .transaction(STORE_SETTINGS, "readonly")
      .objectStore(STORE_SETTINGS)
      .get(`__tamper_backup__${id}`)
  );
}

beforeEach(resetVault);
afterEach(async () => {
  globalThis.__EVOCK_DEV__ = true;
  await resetVault();
});

describe("modify_metadata", () => {
  it("makes verify report MODIFIED with a metadata hash mismatch, then restore returns VERIFIED", async () => {
    const id = await seed();

    expect(await __tamperDemo(id, "modify_metadata")).toEqual({ ok: true, mode: "modify_metadata" });

    const tampered = await verifyEvidence(id, { persist: false });
    expect(tampered.status).toBe("MODIFIED");
    expect(tampered.details).toContain(VERIFY_DETAILS.METADATA_MISMATCH);
    expect(tampered.screenshot_hash_ok).toBe(true);

    await __tamperDemo(id, "restore");
    expect((await verifyEvidence(id, { persist: false })).status).toBe("VERIFIED");
  });

  it("does not touch integrity.*", async () => {
    const id = await seed();
    const before = (await rawRecord(id)).manifest.integrity;

    await __tamperDemo(id, "modify_metadata");
    expect((await rawRecord(id)).manifest.integrity).toEqual(before);
  });
});

describe("modify_screenshot", () => {
  it("makes verify report MODIFIED (not ERROR) with a screenshot hash mismatch, then restore returns VERIFIED", async () => {
    const id = await seed();

    await __tamperDemo(id, "modify_screenshot");

    const tampered = await verifyEvidence(id, { persist: false });
    expect(tampered.status).toBe("MODIFIED");
    expect(tampered.details).toContain(VERIFY_DETAILS.SCREENSHOT_MISMATCH);
    expect(tampered.details).not.toContain(VERIFY_DETAILS.DECRYPTION_FAILED);
    expect(tampered.metadata_hash_ok).toBe(true);
    expect(tampered.manifest_hash_ok).toBe(true);

    await __tamperDemo(id, "restore");
    expect((await verifyEvidence(id, { persist: false })).status).toBe("VERIFIED");
  });
});

describe("restore — byte-exact", () => {
  it("returns the record to identical manifest, ciphertext and iv", async () => {
    const id = await seed();
    const original = await rawRecord(id);
    const originalCipher = new Uint8Array(original.screenshot_ciphertext);
    const originalIv = new Uint8Array(original.iv);

    await __tamperDemo(id, "modify_screenshot");
    await __tamperDemo(id, "modify_metadata");
    await __tamperDemo(id, "restore");

    const restored = await rawRecord(id);
    expect(restored.manifest).toEqual(original.manifest);
    expect(Array.from(new Uint8Array(restored.screenshot_ciphertext))).toEqual(
      Array.from(originalCipher)
    );
    expect(Array.from(new Uint8Array(restored.iv))).toEqual(Array.from(originalIv));
    expect(restored.created_at).toBe(original.created_at);
    expect(restored.platform_label).toBe(original.platform_label);
  });

  it("keeps the first (pristine) backup when modified twice before restore", async () => {
    const id = await seed();
    const original = await rawRecord(id);

    await __tamperDemo(id, "modify_metadata");
    await __tamperDemo(id, "modify_metadata"); // second edit must not overwrite the backup

    await __tamperDemo(id, "restore");
    expect((await rawRecord(id)).manifest).toEqual(original.manifest);
  });

  it("removes the backup row after restore", async () => {
    const id = await seed();
    await __tamperDemo(id, "modify_metadata");
    expect(await backupRow(id)).toBeTruthy();

    await __tamperDemo(id, "restore");
    expect(await backupRow(id)).toBeUndefined();
  });

  it("is a harmless no-op when there is no backup", async () => {
    const id = await seed();
    expect(await __tamperDemo(id, "restore")).toEqual({ ok: true, mode: "restore" });
    expect((await verifyEvidence(id, { persist: false })).status).toBe("VERIFIED");
  });
});

describe("production guard", () => {
  it("throws and writes nothing when the dev flag is off", async () => {
    const id = await seed();
    const before = await rawRecord(id);

    globalThis.__EVOCK_DEV__ = false;
    await expect(__tamperDemo(id, "modify_metadata")).rejects.toThrow(/disabled in production/);
    globalThis.__EVOCK_DEV__ = true;

    expect(await rawRecord(id)).toEqual(before);
    expect(await backupRow(id)).toBeUndefined();
  });
});

describe("misuse", () => {
  it("rejects an unknown mode", async () => {
    const id = await seed();
    await expect(__tamperDemo(id, "delete_everything")).rejects.toThrow(/unknown mode/);
  });

  it("rejects a modify on a missing record", async () => {
    await expect(__tamperDemo("NK-9999", "modify_metadata")).rejects.toThrow(/no record/);
  });
});

describe("the §18 demo sequence, end to end", () => {
  it("verified → tamper → detected → restore → verified", async () => {
    const id = await seed();

    expect((await verifyEvidence(id, { persist: false })).status).toBe("VERIFIED");
    await __tamperDemo(id, "modify_metadata");
    expect((await verifyEvidence(id, { persist: false })).status).toBe("MODIFIED");
    await __tamperDemo(id, "restore");
    expect((await verifyEvidence(id, { persist: false })).status).toBe("VERIFIED");
  });
});

describe("modify_metadata on a failed-extraction record", () => {
  it("alters the provenance line and is detected, then restores clean", async () => {
    const id = await seed("extraction.failed.sample"); // data: null

    await __tamperDemo(id, "modify_metadata");
    const tampered = await verifyEvidence(id, { persist: false });
    expect(tampered.status).toBe("MODIFIED");
    expect(tampered.details).toContain(VERIFY_DETAILS.METADATA_MISMATCH);

    await __tamperDemo(id, "restore");
    expect((await verifyEvidence(id, { persist: false })).status).toBe("VERIFIED");
  });
});
