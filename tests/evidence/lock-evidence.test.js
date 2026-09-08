/**
 * EVOCK — lockEvidence pipeline tests (Role B step 07).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lockEvidence, nowIso } from "../../extension/src/evidence/lock-evidence.js";
import { reduceManifestForHashing } from "../../extension/src/evidence/manifest-builder.js";
import { dataUrlToBytes, sha256Bytes, sha256Canonical } from "../../extension/src/crypto/hash.js";
import { verifyManifestSignature } from "../../extension/src/crypto/sign.js";
import * as vaultRepo from "../../extension/src/storage/vault-repo.js";
import { closeDb, DB_NAME } from "../../extension/src/storage/db.js";
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

const capture = () => loadFixture("capture.sample");
const extractionOk = () => loadFixture("extraction.ok.sample");
const extractionFailed = () => loadFixture("extraction.failed.sample");

beforeEach(resetVault);
afterEach(async () => {
  vi.restoreAllMocks();
  await resetVault();
});

describe("lockEvidence — full run", () => {
  it("produces a complete StoredEvidenceRecord", async () => {
    const record = await lockEvidence({ capture: capture(), extraction: extractionOk() });

    // §5.4 fields
    expect(typeof record.evidence_id).toBe("string");
    expect(record.manifest).toBeTypeOf("object");
    expect(record.screenshot_ciphertext).toBeInstanceOf(ArrayBuffer);
    expect(record.iv).toBeInstanceOf(ArrayBuffer);
    expect(record.created_at).toBe(capture().capturedAt);
    expect(record.platform_label).toBe("WhatsApp");
    expect(record.last_verification).toBeNull();
  });

  it("builds a §5.3-shaped manifest with a real signature and matching IV", async () => {
    const { manifest, iv } = await lockEvidence({
      capture: capture(),
      extraction: extractionOk()
    });

    for (const key of [
      "schema_version",
      "source",
      "capture",
      "visual_artifact",
      "ai_derived_metadata",
      "integrity",
      "signature",
      "timestamp"
    ]) {
      expect(manifest).toHaveProperty(key);
    }

    expect(manifest.signature.signature).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(manifest.signature.signature.length).toBeGreaterThan(0);

    // DoD item 3: a well-formed public key rides in every manifest.
    expect(manifest.signature.public_key_jwk).toMatchObject({ kty: "EC", crv: "P-256" });
    expect(typeof manifest.signature.public_key_jwk.x).toBe("string");
    expect(typeof manifest.signature.public_key_jwk.y).toBe("string");
    expect(manifest.signature.public_key_jwk.d).toBeUndefined();
    expect(manifest.signature.signed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);

    // manifest IV base64 decodes to the same bytes as the stored record IV
    expect(Array.from(dataUrlToBytes(`data:;base64,${manifest.visual_artifact.encryption.iv}`)))
      .toEqual(Array.from(new Uint8Array(iv)));
  });

  it("hashes the screenshot from decoded bytes, pre-encryption", async () => {
    const cap = capture();
    const { manifest } = await lockEvidence({ capture: cap, extraction: extractionOk() });

    expect(manifest.integrity.screenshot_hash).toBe(
      await sha256Bytes(dataUrlToBytes(cap.screenshotDataUrl))
    );
  });

  it("persists the record so get() returns it", async () => {
    const { evidence_id } = await lockEvidence({
      capture: capture(),
      extraction: extractionOk()
    });

    const loaded = await vaultRepo.get(evidence_id);
    expect(loaded.evidence_id).toBe(evidence_id);
    expect(loaded.manifest.integrity.manifest_hash).toBeTruthy();
  });
});

describe("lockEvidence — emit", () => {
  it("fires each stage once, in order", async () => {
    const stages = [];
    await lockEvidence({
      capture: capture(),
      extraction: extractionOk(),
      emit: (s) => stages.push(s)
    });

    expect(stages).toEqual(["hash", "encrypt", "sign", "timestamp", "store"]);
  });

  it("is unharmed by a throwing emit", async () => {
    const record = await lockEvidence({
      capture: capture(),
      extraction: extractionOk(),
      emit: () => {
        throw new Error("progress UI blew up");
      }
    });

    expect(record.evidence_id).toBeTruthy();
  });

  it("works with no emit at all", async () => {
    await expect(
      lockEvidence({ capture: capture(), extraction: extractionOk() })
    ).resolves.toBeTruthy();
  });

  it("is unharmed by an emit that returns a rejecting promise", async () => {
    // chrome.runtime.sendMessage rejects when the popup has closed.
    const record = await lockEvidence({
      capture: capture(),
      extraction: extractionOk(),
      emit: () => Promise.reject(new Error("no receiver"))
    });

    expect(record.evidence_id).toBeTruthy();
  });
});

describe("lockEvidence — atomicity", () => {
  it("writes nothing when a downstream step throws", async () => {
    const encrypt = await import("../../extension/src/crypto/encrypt.js");
    vi.spyOn(encrypt, "encryptBlob").mockRejectedValue(new Error("HSM offline"));

    await expect(
      lockEvidence({ capture: capture(), extraction: extractionOk() })
    ).rejects.toThrow("HSM offline");

    expect(await vaultRepo.count()).toBe(0);
  });

  it("writes nothing when the capture screenshot is not a data URL", async () => {
    const bad = { ...capture(), screenshotDataUrl: "https://example.com/x.png" };

    await expect(lockEvidence({ capture: bad, extraction: extractionOk() })).rejects.toThrow();
    expect(await vaultRepo.count()).toBe(0);
  });

  it("rejects a missing capture or extraction without writing", async () => {
    await expect(lockEvidence({ extraction: extractionOk() })).rejects.toThrow(TypeError);
    await expect(lockEvidence({ capture: capture() })).rejects.toThrow(TypeError);
    expect(await vaultRepo.count()).toBe(0);
  });

  it("writes nothing when signing fails after the id was allocated", async () => {
    const sign = await import("../../extension/src/crypto/sign.js");
    vi.spyOn(sign, "signManifestHash").mockRejectedValue(new Error("keystore locked"));

    await expect(
      lockEvidence({ capture: capture(), extraction: extractionOk() })
    ).rejects.toThrow("keystore locked");

    expect(await vaultRepo.count()).toBe(0);

    // The burned id leaves a gap; the next success skips it. This is the
    // documented cost of putting the id inside the signed manifest.
    vi.restoreAllMocks();
    const next = await lockEvidence({ capture: capture(), extraction: extractionOk() });
    expect(next.evidence_id).toBe("NK-0002");
  });
});

describe("lockEvidence — ids", () => {
  it("assigns sequential ids across calls", async () => {
    const a = await lockEvidence({ capture: capture(), extraction: extractionOk() });
    const b = await lockEvidence({ capture: capture(), extraction: extractionOk() });

    expect([a.evidence_id, b.evidence_id]).toEqual(["NK-0001", "NK-0002"]);
    expect(await vaultRepo.count()).toBe(2);
  });
});

describe("lockEvidence — failed extraction", () => {
  it("still produces a complete stored record", async () => {
    const record = await lockEvidence({
      capture: capture(),
      extraction: extractionFailed()
    });

    expect(record.evidence_id).toBeTruthy();
    expect(record.platform_label).toBe("Unknown");
    expect(record.manifest.ai_derived_metadata.status).toBe("failed");
    expect(record.manifest.ai_derived_metadata.data).toBeNull();
    expect(record.manifest.integrity.metadata_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(record.manifest.signature.signature.length).toBeGreaterThan(0);
  });
});

describe("lockEvidence — determinism", () => {
  // The prompt's spec asks for an identical manifest_hash across runs, but that
  // is unsatisfiable by design: manifest_hash covers visual_artifact.encryption
  // .iv, and every encryptBlob draws a fresh IV (IV reuse under GCM is a real
  // break). The deterministic parts are the ones with no IV in them.
  it("produces identical screenshot_hash and metadata_hash for identical inputs", async () => {
    const first = await lockEvidence({ capture: capture(), extraction: extractionOk() });
    const second = await lockEvidence({ capture: capture(), extraction: extractionOk() });

    expect(second.manifest.integrity.screenshot_hash).toBe(
      first.manifest.integrity.screenshot_hash
    );
    expect(second.manifest.integrity.metadata_hash).toBe(
      first.manifest.integrity.metadata_hash
    );
  });

  it("produces a different IV and manifest_hash on every run", async () => {
    const first = await lockEvidence({ capture: capture(), extraction: extractionOk() });
    const second = await lockEvidence({ capture: capture(), extraction: extractionOk() });

    expect(second.manifest.visual_artifact.encryption.iv).not.toBe(
      first.manifest.visual_artifact.encryption.iv
    );
    expect(second.manifest.integrity.manifest_hash).not.toBe(
      first.manifest.integrity.manifest_hash
    );
  });
});

describe("lockEvidence — the stored record verifies", () => {
  it("has a signature that checks out against the manifest's own key", async () => {
    const { manifest } = await lockEvidence({
      capture: capture(),
      extraction: extractionOk()
    });

    expect(
      await verifyManifestSignature(
        manifest.integrity.manifest_hash,
        manifest.signature.signature,
        manifest.signature.public_key_jwk
      )
    ).toBe(true);
  });

  it("has a manifest_hash that recomputes from the reduced manifest", async () => {
    const { manifest } = await lockEvidence({
      capture: capture(),
      extraction: extractionOk()
    });

    expect(await sha256Canonical(reduceManifestForHashing(manifest))).toBe(
      manifest.integrity.manifest_hash
    );
  });

  it("has a metadata_hash that recomputes from ai_derived_metadata", async () => {
    const { manifest } = await lockEvidence({
      capture: capture(),
      extraction: extractionOk()
    });

    expect(await sha256Canonical(manifest.ai_derived_metadata)).toBe(
      manifest.integrity.metadata_hash
    );
  });
});

describe("nowIso", () => {
  it("formats ISO-8601 with a signed offset", () => {
    expect(nowIso(new Date("2026-09-07T12:00:00Z"))).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/
    );
  });
});

describe("lockEvidence — evidence_id is inside the signed manifest", () => {
  it("populates manifest.evidence_id to match the record and the stored copy", async () => {
    const record = await lockEvidence({ capture: capture(), extraction: extractionOk() });
    const stored = await vaultRepo.get(record.evidence_id);

    expect(record.manifest.evidence_id).toBe(record.evidence_id);
    expect(stored.manifest.evidence_id).toBe(record.evidence_id);
  });

  it("covers evidence_id with manifest_hash — altering it fails recomputation", async () => {
    const { manifest } = await lockEvidence({ capture: capture(), extraction: extractionOk() });

    const altered = structuredClone(manifest);
    altered.evidence_id = "NK-9999";

    expect(await sha256Canonical(reduceManifestForHashing(altered))).not.toBe(
      manifest.integrity.manifest_hash
    );
  });

  it("gives concurrent calls distinct ids and stores both", async () => {
    const [a, b] = await Promise.all([
      lockEvidence({ capture: capture(), extraction: extractionOk() }),
      lockEvidence({ capture: capture(), extraction: extractionOk() })
    ]);

    expect(new Set([a.evidence_id, b.evidence_id]).size).toBe(2);
    expect(a.manifest.evidence_id).toBe(a.evidence_id);
    expect(b.manifest.evidence_id).toBe(b.evidence_id);
    expect(await vaultRepo.count()).toBe(2);
  });
});

describe("lockEvidence — timestamp has a single source", () => {
  it("matches the device provider's output exactly", async () => {
    const { getTimestampProvider } = await import("../../extension/src/crypto/timestamp.js");
    const { manifest } = await lockEvidence({ capture: capture(), extraction: extractionOk() });

    expect(manifest.timestamp).toEqual(
      await getTimestampProvider("device").stamp({ deviceCaptureTime: capture().capturedAt })
    );
  });

  it("rejects a capture with no capturedAt, writing nothing", async () => {
    const bad = { ...capture(), capturedAt: undefined };

    await expect(lockEvidence({ capture: bad, extraction: extractionOk() })).rejects.toThrow(
      /deviceCaptureTime/
    );
    expect(await vaultRepo.count()).toBe(0);
  });
});

describe("lockEvidence — round trip through verification", () => {
  it("lockEvidence then verifyEvidence(id) returns VERIFIED", async () => {
    const { verifyEvidence } = await import("../../extension/src/verify/verifier.js");

    const { evidence_id } = await lockEvidence({
      capture: capture(),
      extraction: extractionOk()
    });

    expect((await verifyEvidence(evidence_id)).status).toBe("VERIFIED");
  });
});
