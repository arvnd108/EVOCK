/**
 * EVOCK — Role C step 01 fixture contract checks (C2).
 *
 * Proves every new fixture parses, matches the frozen §5.3–§5.5 typedefs, and
 * carries no screenshot bytes where the list projection forbids them. The
 * verification detail strings are checked against the ACTUAL exported
 * `VERIFY_DETAILS` — never a hardcoded copy.
 */

import { describe, expect, it } from "vitest";
import { VERIFY_DETAILS } from "../extension/src/verify/verifier.js";
import { decodeRecord, loadUiFixture, SCREENSHOT_PNG_DATA_URL } from "./helpers/ui-fixtures.js";
import { makeVaultList } from "./helpers/make-vault.js";

const ISO_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const VERIFY_DETAIL_VALUES = new Set(Object.values(VERIFY_DETAILS));

const VERIFICATION_RESULT_KEYS = [
  "screenshot_hash_ok",
  "metadata_hash_ok",
  "manifest_hash_ok",
  "signature_ok",
  "status",
  "details",
  "verified_at"
];

describe("verification fixtures — VerificationResult (§5.5)", () => {
  for (const name of [
    "verification.ok.sample",
    "verification.modified.sample",
    "verification.error.sample"
  ]) {
    it(`${name} matches the typedef and uses only frozen detail strings`, () => {
      const v = loadUiFixture(name);
      // Every §5.5 key must be present. `current_integrity` is an OPTIONAL extra
      // (the recomputed hashes the verify panel pairs against the recorded ones —
      // proposed Role B addition, docs/role-c-status.md).
      const keys = Object.keys(v).filter((k) => k !== "current_integrity");
      expect(keys.sort()).toEqual([...VERIFICATION_RESULT_KEYS].sort());
      expect(["VERIFIED", "MODIFIED", "ERROR"]).toContain(v.status);
      for (const k of [
        "screenshot_hash_ok",
        "metadata_hash_ok",
        "manifest_hash_ok",
        "signature_ok"
      ]) {
        expect(typeof v[k]).toBe("boolean");
      }
      expect(Array.isArray(v.details)).toBe(true);
      expect(v.verified_at).toMatch(ISO_OFFSET);
      for (const d of v.details) {
        expect(VERIFY_DETAIL_VALUES.has(d)).toBe(true);
      }
    });
  }

  it("verification.ok is a clean VERIFIED with no details", () => {
    const v = loadUiFixture("verification.ok.sample");
    expect(v.status).toBe("VERIFIED");
    expect(v.screenshot_hash_ok && v.metadata_hash_ok && v.manifest_hash_ok && v.signature_ok).toBe(
      true
    );
    expect(v.details).toEqual([]);
  });

  it("verification.modified is the §18 tamper payoff state", () => {
    const v = loadUiFixture("verification.modified.sample");
    expect(v.status).toBe("MODIFIED");
    expect(v.screenshot_hash_ok).toBe(true);
    expect(v.metadata_hash_ok).toBe(false);
    expect(v.manifest_hash_ok).toBe(false);
    expect(v.signature_ok).toBe(false);
    expect(v.details).toEqual([
      VERIFY_DETAILS.METADATA_MISMATCH,
      VERIFY_DETAILS.MANIFEST_MISMATCH,
      VERIFY_DETAILS.SIGNATURE_INVALID
    ]);
  });

  it("verification.error renders ERROR distinctly (an unevaluable check, not a failed one)", () => {
    const v = loadUiFixture("verification.error.sample");
    expect(v.status).toBe("ERROR");
    expect(v.details).toContain(VERIFY_DETAILS.DECRYPTION_FAILED);
  });
});

describe("record edge-case fixtures — StoredEvidenceRecord (§5.4)", () => {
  const STORED_KEYS = [
    "evidence_id",
    "manifest",
    "screenshot_ciphertext",
    "iv",
    "created_at",
    "platform_label",
    "last_verification"
  ];

  function assertIntactCrypto(rec) {
    expect(rec.manifest.integrity.screenshot_hash).toMatch(HEX64);
    expect(rec.manifest.integrity.metadata_hash).toMatch(HEX64);
    expect(rec.manifest.integrity.manifest_hash).toMatch(HEX64);
    expect(typeof rec.manifest.signature.signature).toBe("string");
    expect(rec.manifest.signature.signature.length).toBeGreaterThan(0);
    expect(rec.manifest.visual_artifact.encryption.algorithm).toBe("AES-GCM");
    expect(typeof rec.screenshot_ciphertext).toBe("string");
    expect(typeof rec.iv).toBe("string");
  }

  it("record.failed-extraction: failed metadata, everything else intact", () => {
    const rec = loadUiFixture("record.failed-extraction.sample");
    expect(
      Object.keys(rec)
        .filter((k) => k !== "_note")
        .sort()
    ).toEqual([...STORED_KEYS].sort());
    expect(rec.manifest.ai_derived_metadata.status).toBe("failed");
    expect(rec.manifest.ai_derived_metadata.data).toBeNull();
    expect(rec.platform_label).toBe("Unknown");
    assertIntactCrypto(rec);
  });

  it("record.null-fields: ok extraction with null platform/contact and no messages", () => {
    const rec = loadUiFixture("record.null-fields.sample");
    expect(rec.manifest.ai_derived_metadata.status).toBe("ok");
    const data = rec.manifest.ai_derived_metadata.data;
    expect(data.platform).toBeNull();
    expect(data.contact_name).toBeNull();
    expect(data.messages).toEqual([]);
    expect(data.visible_time).toBeNull();
    expect(data.date).toBeNull();
    expect(rec.platform_label).toBe("Unknown");
    assertIntactCrypto(rec);
  });

  it("decodeRecord turns the base64 blobs into ArrayBuffer without mutating the input", () => {
    for (const name of [
      "record.sample",
      "record.failed-extraction.sample",
      "record.null-fields.sample"
    ]) {
      const raw = loadUiFixture(name);
      const decoded = decodeRecord(raw);
      expect(decoded.screenshot_ciphertext).toBeInstanceOf(ArrayBuffer);
      expect(decoded.iv).toBeInstanceOf(ArrayBuffer);
      expect(decoded.screenshot_ciphertext.byteLength).toBeGreaterThan(0);
      expect(decoded.iv.byteLength).toBeGreaterThan(0);
      expect(decoded).not.toHaveProperty("_note");
      // input untouched
      expect(typeof raw.screenshot_ciphertext).toBe("string");
    }
  });
});

describe("vault.50.sample.json — list() projection shape (§C3)", () => {
  const PROJECTION_KEYS = [
    "evidence_id",
    "created_at",
    "platform_label",
    // contact_label is the field Role C has asked Role B to add to
    // projectListItem (docs/role-c-status.md); the vault falls back to
    // "unknown account" when it is absent or null.
    "contact_label",
    "source",
    "capture",
    "extraction_status",
    "last_verification"
  ];
  const FORBIDDEN_KEY = /ciphertext|screenshot_data|screenshotDataUrl|\biv\b|screenshot_bytes/i;

  const committed = loadUiFixture("vault.50.sample");

  it("has 50 items, each exactly the projectListItem shape", () => {
    expect(committed).toHaveLength(50);
    for (const item of committed) {
      expect(Object.keys(item).sort()).toEqual([...PROJECTION_KEYS].sort());
      expect(item.evidence_id).toMatch(/^NK-\d{4}$/);
      expect(item.created_at).toMatch(ISO_OFFSET);
      expect(["ok", "failed", null]).toContain(item.extraction_status);
    }
  });

  it("carries no ciphertext, screenshot bytes or iv anywhere", () => {
    const asText = JSON.stringify(committed);
    expect(FORBIDDEN_KEY.test(asText)).toBe(false);
  });

  it("spans at least 10 calendar days and varies platform + verification state", () => {
    const days = new Set(committed.map((x) => x.created_at.slice(0, 10)));
    expect(days.size).toBeGreaterThanOrEqual(10);
    expect(new Set(committed.map((x) => x.platform_label))).toEqual(
      new Set(["WhatsApp", "Instagram", "Website", "Unknown"])
    );
    const verifStates = new Set(
      committed.map((x) => (x.last_verification ? x.last_verification.status : "never"))
    );
    expect(verifStates.has("never")).toBe(true);
    expect(verifStates.has("VERIFIED")).toBe(true);
  });

  it("embedded last_verification objects use only frozen detail strings", () => {
    for (const item of committed) {
      if (!item.last_verification) continue;
      for (const d of item.last_verification.details) {
        expect(VERIFY_DETAIL_VALUES.has(d)).toBe(true);
      }
    }
  });

  it("is byte-identical to makeVaultList(50), which is deterministic", () => {
    expect(makeVaultList(50)).toEqual(committed);
    expect(makeVaultList(50)).toEqual(makeVaultList(50));
  });

  it("makeVaultList scales past 50 and stays deterministic", () => {
    const a = makeVaultList(120);
    const b = makeVaultList(120);
    expect(a).toHaveLength(120);
    expect(a).toEqual(b);
    expect(new Set(a.map((x) => x.created_at.slice(0, 10))).size).toBeGreaterThanOrEqual(20);
  });
});

describe("SCREENSHOT_PNG_DATA_URL", () => {
  it("is a real PNG data URL", () => {
    expect(SCREENSHOT_PNG_DATA_URL.startsWith("data:image/png;base64,")).toBe(true);
    expect(SCREENSHOT_PNG_DATA_URL.length).toBeGreaterThan(40);
  });
});
