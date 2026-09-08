/**
 * EVOCK — evidence vault repository tests (Role B step 06, B6).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  count,
  get,
  getDecryptedScreenshot,
  list,
  put,
  remove,
  updateVerification,
  VaultQuotaError
} from "../../extension/src/storage/vault-repo.js";
import {
  EVIDENCE_COUNTER_KEY,
  formatEvidenceId,
  nextEvidenceId
} from "../../extension/src/shared/ids.js";
import {
  closeDb,
  DB_NAME,
  openDb,
  requestToPromise,
  STORE_EVIDENCE,
  STORE_SETTINGS,
  txDone
} from "../../extension/src/storage/db.js";
import { encryptBlob, getVaultKey } from "../../extension/src/crypto/encrypt.js";
import { loadFixture } from "../helpers/fixtures.js";

/** Wipe the vault between tests so ids and counts start clean. */
async function resetVault() {
  await closeDb();
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

/**
 * A minimal, valid StoredEvidenceRecord with real ArrayBuffers, derived from the
 * fixture manifest. `plaintext` is the bytes the ciphertext decrypts to.
 */
async function makeRecord(overrides = {}) {
  const manifest = structuredClone(loadFixture("manifest.sample"));
  const plaintext = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const key = await getVaultKey();
  const { ciphertext, iv } = await encryptBlob(plaintext, key);

  return {
    record: {
      // no evidence_id: let put() allocate it
      manifest,
      screenshot_ciphertext: ciphertext,
      iv: iv.buffer,
      created_at: "2026-09-01T23:31:14+05:30",
      platform_label: "WhatsApp",
      last_verification: null,
      ...overrides
    },
    plaintext
  };
}

beforeEach(resetVault);
afterEach(resetVault);

describe("nextEvidenceId / formatEvidenceId", () => {
  it("formats zero-padded ids and grows past 9999", () => {
    expect(formatEvidenceId(1)).toBe("NK-0001");
    expect(formatEvidenceId(42)).toBe("NK-0042");
    expect(formatEvidenceId(9999)).toBe("NK-9999");
    expect(formatEvidenceId(10000)).toBe("NK-10000");
  });

  it("rejects non-positive integers", () => {
    expect(() => formatEvidenceId(0)).toThrow(TypeError);
    expect(() => formatEvidenceId(-1)).toThrow(TypeError);
    expect(() => formatEvidenceId(1.5)).toThrow(TypeError);
  });

  it("increments the counter inside the caller's transaction", async () => {
    const db = await openDb();

    const tx = db.transaction(STORE_SETTINGS, "readwrite");
    const first = await nextEvidenceId(tx);
    const second = await nextEvidenceId(tx);
    await txDone(tx);

    expect([first, second]).toEqual(["NK-0001", "NK-0002"]);

    const row = await requestToPromise(
      db.transaction(STORE_SETTINGS, "readonly").objectStore(STORE_SETTINGS).get(EVIDENCE_COUNTER_KEY)
    );
    expect(row.value).toBe(2);
  });

  it("rejects a bad transaction argument", async () => {
    await expect(nextEvidenceId(null)).rejects.toThrow(TypeError);
  });
});

describe("put / get — round trip", () => {
  it("stores and returns a deep-equal record, ciphertext included", async () => {
    const { record } = await makeRecord();

    const stored = await put(record);
    expect(stored.evidence_id).toBe("NK-0001");

    const loaded = await get("NK-0001");
    expect(loaded.evidence_id).toBe("NK-0001");
    expect(loaded.manifest).toEqual(record.manifest);
    expect(new Uint8Array(loaded.screenshot_ciphertext)).toEqual(
      new Uint8Array(record.screenshot_ciphertext)
    );
    expect(new Uint8Array(loaded.iv)).toEqual(new Uint8Array(record.iv));
    expect(loaded.created_at).toBe(record.created_at);
    expect(loaded.platform_label).toBe(record.platform_label);
    expect(loaded.last_verification).toBeNull();
  });

  it("uses a caller-supplied evidence_id as-is, without touching the counter", async () => {
    const { record } = await makeRecord({ evidence_id: "NK-0007" });

    const stored = await put(record);
    expect(stored.evidence_id).toBe("NK-0007");

    // A subsequent auto-allocated id still starts at NK-0001.
    const { record: second } = await makeRecord();
    expect((await put(second)).evidence_id).toBe("NK-0001");
  });

  it("refuses to overwrite an existing id", async () => {
    const { record } = await makeRecord({ evidence_id: "NK-0009" });
    await put(record);

    const { record: clash } = await makeRecord({ evidence_id: "NK-0009" });
    await expect(put(clash)).rejects.toThrow();
    expect(await count()).toBe(1);
  });

  it("rejects a structurally invalid record", async () => {
    await expect(put(null)).rejects.toThrow(TypeError);
    await expect(put({ manifest: {}, iv: new ArrayBuffer(12), created_at: "x", platform_label: "y" })).rejects.toThrow(
      /screenshot_ciphertext/
    );
    const { record } = await makeRecord({ created_at: "" });
    await expect(put(record)).rejects.toThrow(/created_at/);
  });
});

describe("put — id allocation is atomic under concurrency", () => {
  it("gives distinct ids to two puts fired without awaiting between them", async () => {
    const [a, b] = await Promise.all([
      makeRecord().then(({ record }) => put(record)),
      makeRecord().then(({ record }) => put(record))
    ]);

    expect(new Set([a.evidence_id, b.evidence_id]).size).toBe(2);
    expect([a.evidence_id, b.evidence_id].sort()).toEqual(["NK-0001", "NK-0002"]);
    expect(await count()).toBe(2);
  });

  it("keeps ids distinct across ten concurrent puts", async () => {
    const records = await Promise.all(
      Array.from({ length: 10 }, () => makeRecord().then((r) => r.record))
    );
    const stored = await Promise.all(records.map((r) => put(r)));

    expect(new Set(stored.map((r) => r.evidence_id)).size).toBe(10);
    expect(await count()).toBe(10);
  });
});

describe("list — metadata only", () => {
  it("never returns ciphertext or iv", async () => {
    const { record } = await makeRecord();
    await put(record);

    const [item] = await list();

    expect(Object.keys(item).sort()).toEqual(
      [
        "capture",
        "contact_label",
        "created_at",
        "evidence_id",
        "extraction_status",
        "last_verification",
        "platform_label",
        "source"
      ].sort()
    );
    expect(item).not.toHaveProperty("screenshot_ciphertext");
    expect(item).not.toHaveProperty("iv");
    expect(item).not.toHaveProperty("manifest");
  });

  it("renders a 50-record vault as a small result", async () => {
    for (let i = 0; i < 50; i++) {
      const { record } = await makeRecord({
        created_at: `2026-09-01T${String(i % 24).padStart(2, "0")}:00:00+00:00`
      });
      await put(record);
    }

    const items = await list();
    expect(items).toHaveLength(50);

    // Each stored ciphertext is small in the test, but the projected result must
    // not scale with it: no item carries a buffer at all.
    const serialised = JSON.stringify(items);
    expect(serialised).not.toContain("screenshot_ciphertext");
    for (const item of items) {
      expect(item).toHaveProperty("contact_label");
      for (const value of Object.values(item)) {
        expect(value instanceof ArrayBuffer).toBe(false);
      }
    }
  });

  it("carries the AI-derived contact name, or null when there is none", async () => {
    const named = await makeRecord();
    named.record.manifest.ai_derived_metadata.data.contact_name = "Mr. ABC B";
    await put(named.record);

    const failed = await makeRecord({ platform_label: "Unknown" });
    failed.record.manifest.ai_derived_metadata = {
      provider: "vision",
      model: null,
      status: "failed",
      extracted_at: null,
      data: null
    };
    await put(failed.record);

    const byId = Object.fromEntries((await list()).map((i) => [i.evidence_id, i]));
    expect(byId["NK-0001"].contact_label).toBe("Mr. ABC B");
    expect(byId["NK-0002"].contact_label).toBeNull();
  });

  it("sorts newest first by default and oldest first on request", async () => {
    const times = [
      "2026-09-01T10:00:00+00:00",
      "2026-09-03T10:00:00+00:00",
      "2026-09-02T10:00:00+00:00"
    ];
    for (const created_at of times) {
      const { record } = await makeRecord({ created_at });
      await put(record);
    }

    const newest = (await list()).map((r) => r.created_at);
    expect(newest).toEqual([
      "2026-09-03T10:00:00+00:00",
      "2026-09-02T10:00:00+00:00",
      "2026-09-01T10:00:00+00:00"
    ]);

    const oldest = (await list({ sort: "oldest" })).map((r) => r.created_at);
    expect(oldest).toEqual([...newest].reverse());
  });

  it("filters by platform_label", async () => {
    for (const platform_label of ["WhatsApp", "Instagram", "WhatsApp"]) {
      const { record } = await makeRecord({ platform_label });
      await put(record);
    }

    const wa = await list({ filter: { platform_label: "WhatsApp" } });
    expect(wa).toHaveLength(2);
    expect(wa.every((r) => r.platform_label === "WhatsApp")).toBe(true);

    expect(await list({ filter: { platform_label: "Nope" } })).toHaveLength(0);
  });

  it("returns an empty array for an empty vault", async () => {
    expect(await list()).toEqual([]);
  });
});

describe("getDecryptedScreenshot", () => {
  it("returns a Blob of the original plaintext with the manifest mime type", async () => {
    const { record, plaintext } = await makeRecord();
    await put(record);

    const blob = await getDecryptedScreenshot("NK-0001");
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/png");

    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(plaintext));
  });

  it("throws for an unknown id", async () => {
    await expect(getDecryptedScreenshot("NK-9999")).rejects.toThrow(/NK-9999/);
  });
});

describe("updateVerification", () => {
  it("sets last_verification without touching manifest or ciphertext", async () => {
    const { record } = await makeRecord();
    await put(record);
    const before = await get("NK-0001");

    const result = {
      screenshot_hash_ok: true,
      metadata_hash_ok: true,
      manifest_hash_ok: true,
      signature_ok: true,
      status: "VERIFIED",
      details: [],
      verified_at: "2026-09-02T09:00:00+00:00"
    };
    await updateVerification("NK-0001", result);

    const after = await get("NK-0001");
    expect(after.last_verification).toEqual(result);
    expect(after.manifest).toEqual(before.manifest);
    expect(new Uint8Array(after.screenshot_ciphertext)).toEqual(
      new Uint8Array(before.screenshot_ciphertext)
    );
  });

  it("throws for an unknown id", async () => {
    await expect(updateVerification("NK-9999", {})).rejects.toThrow(/NK-9999/);
  });
});

describe("remove / count", () => {
  it("counts records and deletes on request", async () => {
    expect(await count()).toBe(0);

    const { record: a } = await makeRecord();
    const { record: b } = await makeRecord();
    await put(a);
    await put(b);
    expect(await count()).toBe(2);

    await remove("NK-0001");
    expect(await count()).toBe(1);
    expect(await get("NK-0001")).toBeUndefined();

    // ids are not reused after a delete
    const { record: c } = await makeRecord();
    expect((await put(c)).evidence_id).toBe("NK-0003");
  });
});

describe("put — quota exhaustion", () => {
  it("re-throws a QuotaExceededError as a typed VaultQuotaError", async () => {
    const db = await openDb();
    const realTransaction = db.transaction.bind(db);
    const spy = vi.spyOn(db, "transaction").mockImplementation((...args) => {
      const tx = realTransaction(...args);
      const store = tx.objectStore(STORE_EVIDENCE);
      store.add = () => {
        const request = {};
        queueMicrotask(() => {
          request.error = new DOMException("The quota has been exceeded.", "QuotaExceededError");
          request.onerror?.({ target: request });
        });
        return request;
      };
      return tx;
    });

    try {
      const { record } = await makeRecord();
      await expect(put(record)).rejects.toBeInstanceOf(VaultQuotaError);
      await expect(put(record)).rejects.toThrow(/Local storage is full/);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("resilience", () => {
  it("nextEvidenceId refuses a corrupt counter rather than reissuing live ids", async () => {
    const db = await openDb();
    let tx = db.transaction(STORE_SETTINGS, "readwrite");
    tx.objectStore(STORE_SETTINGS).put({ key: EVIDENCE_COUNTER_KEY, value: "not-a-number" });
    await txDone(tx);

    tx = db.transaction(STORE_SETTINGS, "readwrite");
    await expect(nextEvidenceId(tx)).rejects.toThrow(/corrupt/);
  });

  it("list() degrades gracefully for a record missing its manifest", async () => {
    // A record can only get here by bypassing put() (e.g. the step-09 tamper
    // harness writes raw). list() must still return, with nulls, not throw.
    const db = await openDb();
    const tx = db.transaction(STORE_EVIDENCE, "readwrite");
    tx.objectStore(STORE_EVIDENCE).add({
      evidence_id: "NK-0001",
      created_at: "2026-09-01T10:00:00+00:00",
      platform_label: "WhatsApp",
      screenshot_ciphertext: new ArrayBuffer(8),
      iv: new ArrayBuffer(12),
      last_verification: null
    });
    await txDone(tx);

    const [item] = await list();
    expect(item.evidence_id).toBe("NK-0001");
    expect(item.source).toBeNull();
    expect(item.capture).toBeNull();
    expect(item.extraction_status).toBeNull();
  });
});
