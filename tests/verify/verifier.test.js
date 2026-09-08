/**
 * EVOCK — verification engine tests (Role B step 08, B7).
 *
 * The tamper matrix: every way a stored record can be altered must produce
 * MODIFIED (or ERROR) with the correct specific detail, and an untouched record
 * must produce VERIFIED every time.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyEvidence, VERIFY_DETAILS } from "../../extension/src/verify/verifier.js";
import { lockEvidence } from "../../extension/src/evidence/lock-evidence.js";
import { reduceManifestForHashing } from "../../extension/src/evidence/manifest-builder.js";
import { encryptBlob, getVaultKey } from "../../extension/src/crypto/encrypt.js";
import {
  bytesToBase64,
  dataUrlToBytes,
  sha256Bytes,
  sha256Canonical
} from "../../extension/src/crypto/hash.js";
import { verifyManifestSignature } from "../../extension/src/crypto/sign.js";
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

/** Seed one clean record and return its id. */
async function seedRecord(extractionName = "extraction.ok.sample") {
  const { evidence_id } = await lockEvidence({
    capture: loadFixture("capture.sample"),
    extraction: loadFixture(extractionName)
  });
  return evidence_id;
}

/** Read the raw stored row. */
async function readRaw(id) {
  const db = await openDb();
  return requestToPromise(
    db.transaction(STORE_EVIDENCE, "readonly").objectStore(STORE_EVIDENCE).get(id)
  );
}

/** Write a raw row back, bypassing vault-repo — an attacker editing storage. */
async function writeRaw(record) {
  const db = await openDb();
  const tx = db.transaction(STORE_EVIDENCE, "readwrite");
  tx.objectStore(STORE_EVIDENCE).put(record);
  await txDone(tx);
}

/** Mutate the stored manifest through `fn` and write it back. */
async function tamperManifest(id, fn) {
  const record = await readRaw(id);
  fn(record.manifest);
  await writeRaw(record);
}

async function freshPublicJwk() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify"
  ]);
  return crypto.subtle.exportKey("jwk", pair.publicKey);
}

beforeEach(resetVault);
afterEach(resetVault);

describe("1. clean record", () => {
  it("verifies, with all four checks true and no details", async () => {
    const id = await seedRecord();
    const result = await verifyEvidence(id);

    expect(result.status).toBe("VERIFIED");
    expect(result.screenshot_hash_ok).toBe(true);
    expect(result.metadata_hash_ok).toBe(true);
    expect(result.manifest_hash_ok).toBe(true);
    expect(result.signature_ok).toBe(true);
    expect(result.details).toEqual([]);
    expect(result.verified_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });

  it("verifies 100 times out of 100", async () => {
    const id = await seedRecord();
    for (let i = 0; i < 100; i++) {
      expect((await verifyEvidence(id, { persist: false })).status).toBe("VERIFIED");
    }
  });

  it("persists the result onto the record by default", async () => {
    const id = await seedRecord();
    await verifyEvidence(id);

    const raw = await readRaw(id);
    expect(raw.last_verification.status).toBe("VERIFIED");
  });

  it("does not persist when asked not to", async () => {
    const id = await seedRecord();
    await verifyEvidence(id, { persist: false });

    expect((await readRaw(id)).last_verification).toBeNull();
  });
});

describe("2. screenshot byte flip", () => {
  it("is MODIFIED with only the screenshot check failing", async () => {
    const id = await seedRecord();
    const record = await readRaw(id);

    const plaintext = new Uint8Array(
      await (async () => {
        const { decryptBlob } = await import("../../extension/src/crypto/encrypt.js");
        return decryptBlob(record.screenshot_ciphertext, record.iv, await getVaultKey());
      })()
    );
    plaintext[0] ^= 0xff;
    const { ciphertext, iv } = await encryptBlob(plaintext, await getVaultKey());
    record.screenshot_ciphertext = ciphertext;
    record.iv = iv.buffer;
    await writeRaw(record);

    const result = await verifyEvidence(id);
    expect(result.status).toBe("MODIFIED");
    expect(result.screenshot_hash_ok).toBe(false);
    expect(result.metadata_hash_ok).toBe(true);
    expect(result.manifest_hash_ok).toBe(true);
    expect(result.signature_ok).toBe(true);
    expect(result.details).toEqual([VERIFY_DETAILS.SCREENSHOT_MISMATCH]);
  });
});

describe("3. message text change", () => {
  it("is MODIFIED on metadata and manifest, screenshot untouched", async () => {
    const id = await seedRecord();
    await tamperManifest(id, (m) => {
      m.ai_derived_metadata.data.messages[0].text += "!";
    });

    const result = await verifyEvidence(id);
    expect(result.status).toBe("MODIFIED");
    expect(result.screenshot_hash_ok).toBe(true);
    expect(result.metadata_hash_ok).toBe(false);
    expect(result.manifest_hash_ok).toBe(false);
    expect(result.details).toEqual(
      expect.arrayContaining([VERIFY_DETAILS.METADATA_MISMATCH, VERIFY_DETAILS.MANIFEST_MISMATCH])
    );
  });
});

describe("4. provenance change", () => {
  it("is MODIFIED with a metadata mismatch", async () => {
    const id = await seedRecord();
    await tamperManifest(id, (m) => {
      m.ai_derived_metadata.provider = m.ai_derived_metadata.provider === "vision" ? "demo" : "vision";
    });

    const result = await verifyEvidence(id);
    expect(result.status).toBe("MODIFIED");
    expect(result.metadata_hash_ok).toBe(false);
    expect(result.details).toContain(VERIFY_DETAILS.METADATA_MISMATCH);
  });
});

describe("5. message array reorder", () => {
  it("is MODIFIED with a metadata mismatch", async () => {
    const id = await seedRecord();
    // Give it a second message first so order is observable.
    await tamperManifest(id, (m) => {
      m.ai_derived_metadata.data.messages.push({
        sender: "Mr. ABC B",
        text: "second",
        visible_timestamp: "11:29 PM",
        type: "incoming"
      });
    });
    // That already made it MODIFIED; re-seed cleanly with two messages instead.
    await resetVault();
    const extraction = loadFixture("extraction.ok.sample");
    extraction.data.messages.push({
      sender: "Mr. ABC B",
      text: "second",
      visible_timestamp: "11:29 PM",
      type: "incoming"
    });
    const { evidence_id } = await lockEvidence({
      capture: loadFixture("capture.sample"),
      extraction
    });

    await tamperManifest(evidence_id, (m) => {
      m.ai_derived_metadata.data.messages.reverse();
    });

    const result = await verifyEvidence(evidence_id);
    expect(result.status).toBe("MODIFIED");
    expect(result.metadata_hash_ok).toBe(false);
    expect(result.details).toContain(VERIFY_DETAILS.METADATA_MISMATCH);
  });
});

describe("6. signature corruption", () => {
  it("is MODIFIED with signature invalid, hashes still fine", async () => {
    const id = await seedRecord();
    await tamperManifest(id, (m) => {
      const sig = m.signature.signature;
      const i = 5;
      const swapped = sig[i] === "A" ? "B" : "A";
      m.signature.signature = sig.slice(0, i) + swapped + sig.slice(i + 1);
    });

    const result = await verifyEvidence(id);
    expect(result.status).toBe("MODIFIED");
    expect(result.screenshot_hash_ok).toBe(true);
    expect(result.metadata_hash_ok).toBe(true);
    expect(result.manifest_hash_ok).toBe(true);
    expect(result.signature_ok).toBe(false);
    expect(result.details).toContain(VERIFY_DETAILS.SIGNATURE_INVALID);
  });
});

describe("7. wrong (but valid) public key", () => {
  it("is MODIFIED with signature invalid and does not throw", async () => {
    const id = await seedRecord();
    const otherJwk = await freshPublicJwk();
    await tamperManifest(id, (m) => {
      m.signature.public_key_jwk = otherJwk;
    });

    const result = await verifyEvidence(id);
    expect(result.status).toBe("MODIFIED");
    expect(result.signature_ok).toBe(false);
    expect(result.details).toContain(VERIFY_DETAILS.SIGNATURE_INVALID);
    expect(result.details).not.toContain(VERIFY_DETAILS.KEY_MALFORMED);
  });

  it("reports a malformed key distinctly", async () => {
    const id = await seedRecord();
    await tamperManifest(id, (m) => {
      m.signature.public_key_jwk = { kty: "EC", crv: "P-256" }; // no x/y
    });

    const result = await verifyEvidence(id);
    expect(result.signature_ok).toBe(false);
    expect(result.details).toContain(VERIFY_DETAILS.KEY_MALFORMED);
    expect(result.details).not.toContain(VERIFY_DETAILS.SIGNATURE_INVALID);
  });
});

describe("8. decryption failure", () => {
  it("is ERROR with a decryption-failed detail", async () => {
    const id = await seedRecord();
    const record = await readRaw(id);
    record.screenshot_ciphertext = crypto.getRandomValues(new Uint8Array(64)).buffer;
    await writeRaw(record);

    const result = await verifyEvidence(id);
    expect(result.status).toBe("ERROR");
    expect(result.screenshot_hash_ok).toBe(false);
    expect(result.details).toContain(VERIFY_DETAILS.DECRYPTION_FAILED);
  });
});

describe("9. missing record", () => {
  it("is ERROR with record not found and does not persist", async () => {
    const result = await verifyEvidence("NK-9999");

    expect(result.status).toBe("ERROR");
    expect(result.details).toEqual([VERIFY_DETAILS.RECORD_NOT_FOUND]);
    expect(result.screenshot_hash_ok).toBe(false);
    expect(result.signature_ok).toBe(false);
  });
});

describe("10. third-party verification, empty vault", () => {
  it("verifies from the manifest and screenshot bytes alone", async () => {
    const id = await seedRecord();
    const record = await readRaw(id);

    // What an exported package carries: the manifest, and the decrypted PNG.
    const { decryptBlob } = await import("../../extension/src/crypto/encrypt.js");
    const screenshotBytes = new Uint8Array(
      await decryptBlob(record.screenshot_ciphertext, record.iv, await getVaultKey())
    );
    const manifest = structuredClone(record.manifest);

    await resetVault(); // nothing left in IndexedDB

    expect(await sha256Bytes(screenshotBytes)).toBe(manifest.integrity.screenshot_hash);
    expect(await sha256Canonical(reduceManifestForHashing(manifest))).toBe(
      manifest.integrity.manifest_hash
    );
    expect(
      await verifyManifestSignature(
        manifest.integrity.manifest_hash,
        manifest.signature.signature,
        manifest.signature.public_key_jwk
      )
    ).toBe(true);
  });
});

describe("structural breakage", () => {
  it("is ERROR when the manifest has no integrity block", async () => {
    const id = await seedRecord();
    const record = await readRaw(id);
    delete record.manifest.integrity;
    await writeRaw(record);

    const result = await verifyEvidence(id);
    expect(result.status).toBe("ERROR");
    expect(result.details).toContain(VERIFY_DETAILS.MANIFEST_MISMATCH);
  });

  it("is ERROR when ai_derived_metadata cannot be canonicalised", async () => {
    const id = await seedRecord();
    const record = await readRaw(id);
    record.manifest.ai_derived_metadata.data.captured = new Date();
    await writeRaw(record);

    const result = await verifyEvidence(id);
    expect(result.status).toBe("ERROR");
  });
});

describe("verifyEvidence — round trip with lockEvidence", () => {
  it("locks then verifies VERIFIED", async () => {
    const { evidence_id } = await lockEvidence({
      capture: loadFixture("capture.sample"),
      extraction: loadFixture("extraction.failed.sample")
    });

    expect((await verifyEvidence(evidence_id)).status).toBe("VERIFIED");
  });
});

describe("VERIFY_DETAILS", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(VERIFY_DETAILS)).toBe(true);
  });
});

describe("verifyEvidence — no side effects on the manifest", () => {
  it("leaves the stored manifest byte-identical, so re-verify still passes", async () => {
    const { canonicalize } = await import("../../extension/src/evidence/canonicalize.js");
    const id = await seedRecord();

    const before = canonicalize((await readRaw(id)).manifest);
    await verifyEvidence(id); // persists last_verification onto the record, not the manifest
    const after = canonicalize((await readRaw(id)).manifest);

    expect(after).toBe(before);
    expect((await verifyEvidence(id)).status).toBe("VERIFIED");
  });
});

describe("verifyEvidence — compound failure", () => {
  it("is ERROR and lists every failed check when decryption AND metadata both break", async () => {
    const id = await seedRecord();
    const record = await readRaw(id);
    record.screenshot_ciphertext = crypto.getRandomValues(new Uint8Array(48)).buffer;
    record.manifest.ai_derived_metadata.data.messages[0].text = "changed";
    await writeRaw(record);

    const result = await verifyEvidence(id);
    expect(result.status).toBe("ERROR");
    expect(result.details).toEqual(
      expect.arrayContaining([
        VERIFY_DETAILS.DECRYPTION_FAILED,
        VERIFY_DETAILS.METADATA_MISMATCH,
        VERIFY_DETAILS.MANIFEST_MISMATCH
      ])
    );
  });

  it("never lists the same detail twice", async () => {
    const id = await seedRecord();
    await tamperManifest(id, (m) => {
      m.ai_derived_metadata.data.messages[0].text += "x";
    });

    const { details } = await verifyEvidence(id);
    expect(details.length).toBe(new Set(details).size);
  });
});

describe("current_integrity — recomputed hashes for Role C's MODIFIED panel", () => {
  it("matches manifest.integrity.* on a clean record", async () => {
    const id = await seedRecord();
    const manifest = (await readRaw(id)).manifest;

    const result = await verifyEvidence(id, { persist: false });

    expect(result.current_integrity).toEqual({
      screenshot_hash: manifest.integrity.screenshot_hash,
      metadata_hash: manifest.integrity.metadata_hash,
      manifest_hash: manifest.integrity.manifest_hash
    });
  });

  it("differs from the recorded hash after a metadata tamper, and is not null", async () => {
    const id = await seedRecord();
    const recorded = (await readRaw(id)).manifest.integrity;
    await tamperManifest(id, (m) => {
      m.ai_derived_metadata.data.messages[0].text += "!";
    });

    const result = await verifyEvidence(id, { persist: false });

    expect(result.current_integrity.metadata_hash).not.toBeNull();
    expect(result.current_integrity.metadata_hash).not.toBe(recorded.metadata_hash);
    expect(result.current_integrity.manifest_hash).not.toBe(recorded.manifest_hash);
    // the screenshot was untouched, so its recomputed hash still matches
    expect(result.current_integrity.screenshot_hash).toBe(recorded.screenshot_hash);
  });

  it("leaves screenshot_hash null on a decryption failure but keeps the other two", async () => {
    const id = await seedRecord();
    const record = await readRaw(id);
    record.screenshot_ciphertext = crypto.getRandomValues(new Uint8Array(64)).buffer;
    await writeRaw(record);

    const result = await verifyEvidence(id, { persist: false });

    expect(result.status).toBe("ERROR");
    expect(result.current_integrity.screenshot_hash).toBeNull();
    expect(result.current_integrity.metadata_hash).not.toBeNull();
    expect(result.current_integrity.manifest_hash).not.toBeNull();
  });

  it("is present with all-null values on RECORD_NOT_FOUND", async () => {
    const result = await verifyEvidence("NK-9999");

    expect(result.current_integrity).toEqual({
      screenshot_hash: null,
      metadata_hash: null,
      manifest_hash: null
    });
  });

  it("is present with all-null values on a structurally broken manifest", async () => {
    const id = await seedRecord();
    const record = await readRaw(id);
    delete record.manifest.integrity;
    await writeRaw(record);

    const result = await verifyEvidence(id, { persist: false });

    expect(result.status).toBe("ERROR");
    expect(result.current_integrity).toEqual({
      screenshot_hash: null,
      metadata_hash: null,
      manifest_hash: null
    });
  });

  it("survives the persist round trip on last_verification", async () => {
    const id = await seedRecord();
    await verifyEvidence(id); // persist: true

    const stored = (await readRaw(id)).last_verification;
    expect(stored.current_integrity.metadata_hash).toBeTruthy();
  });
});
