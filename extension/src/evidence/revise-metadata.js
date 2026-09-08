/**
 * EVOCK — human corrections to AI-derived metadata (Role B, schema 1.1).
 *
 * The vision model misreads a name or a timestamp; the user fixes it. This does
 * NOT overwrite the signed record. The evidence core canonicalises, re-hashes
 * and re-signs the corrected metadata and APPENDS a new version. The original
 * AI-derived version is kept and stays independently verifiable (spec §26.4).
 *
 * A correction is metadata-only: the screenshot bytes, `integrity.screenshot_hash`
 * and the IV are identical across every version. Only `metadata_hash`,
 * `manifest_hash`, `signature` and `signed_at` change.
 *
 * Role C collects the corrected data and calls this through the worker; Role C
 * never signs and never writes the vault.
 */

import { getSigningKeyPair, getSigningPublicKeyJwk } from "../crypto/keystore.js";
import { sha256Canonical } from "../crypto/hash.js";
import { signManifestHash } from "../crypto/sign.js";
import { nowIso } from "../shared/iso-time.js";
import * as vaultRepo from "../storage/vault-repo.js";
import { reduceManifestForHashing } from "./manifest-builder.js";
import { normalizeVersions } from "./versions.js";

/**
 * Append a human-corrected version. Never mutates an existing version. Atomic:
 * if any step throws, nothing is written — no half-appended version.
 *
 * @param {string} evidence_id
 * @param {import("../shared/types.js").ExtractedData} data  corrected ai_derived_metadata.data
 * @param {{ note?: string|null }} [opts]
 * @returns {Promise<import("../shared/types.js").StoredEvidenceRecord>}  the updated record
 */
export async function reviseMetadata(evidence_id, data, { note = null } = {}) {
  if (data === undefined || data === null || typeof data !== "object") {
    throw new TypeError("reviseMetadata: corrected `data` object is required");
  }

  const record = await vaultRepo.get(evidence_id);
  if (!record) {
    throw new Error(`reviseMetadata: no record "${evidence_id}"`);
  }

  // A fresh array we own. normalizeVersions may hand back record.versions by
  // reference; copying keeps existing version objects untouched.
  const versions = [...normalizeVersions(record)];
  const prev = versions.at(-1)?.manifest;
  if (!prev || typeof prev !== "object") {
    throw new Error(`reviseMetadata: record "${evidence_id}" has no manifest to revise`);
  }

  // Start from a full deep copy of the previous manifest, then change only the
  // metadata and the fields derived from it. structuredClone isolates the new
  // version from every earlier one.
  const newManifest = structuredClone(prev);

  newManifest.ai_derived_metadata = {
    ...structuredClone(prev.ai_derived_metadata),
    // provider / model / extracted_at stay as they were — the human origin is
    // recorded on the version wrapper, not by faking the provider enum. If v(n-1)
    // was a failed extraction and the human is now supplying data, it is "ok".
    status: "ok",
    data: structuredClone(data)
  };

  const metadata_hash = await sha256Canonical(newManifest.ai_derived_metadata);
  newManifest.integrity = {
    ...newManifest.integrity,
    metadata_hash, // recomputed
    // screenshot_hash: copied unchanged via the spread above
    manifest_hash: null // excluded from its own input; written back below
  };

  // Clear the signature before hashing the reduced manifest (same rule as
  // buildManifest: signature is excluded from manifest_hash).
  const public_key_jwk = await getSigningPublicKeyJwk();
  newManifest.signature = {
    ...newManifest.signature,
    public_key_jwk,
    signature: null,
    signed_at: null
  };

  const manifest_hash = await sha256Canonical(reduceManifestForHashing(newManifest));
  newManifest.integrity.manifest_hash = manifest_hash;

  const { privateKey } = await getSigningKeyPair();
  newManifest.signature.signature = await signManifestHash(manifest_hash, privateKey);
  newManifest.signature.signed_at = nowIso();

  // timestamp block: device_capture_time is the original capture, unchanged — a
  // revision is not a new capture. structuredClone carried it over verbatim.

  /** @type {import("../shared/types.js").RecordVersion} */
  const newVersion = {
    version: versions.length + 1,
    origin: "human",
    author: null,
    note: typeof note === "string" && note.length > 0 ? note : null,
    created_at: nowIso(),
    manifest: newManifest
  };
  versions.push(newVersion);

  /** @type {import("../shared/types.js").StoredEvidenceRecord} */
  const updated = {
    ...record,
    manifest: newManifest, // mirror the latest version
    platform_label: data?.platform || "Unknown",
    last_verification: null, // the latest version has not been verified yet
    versions
  };

  return vaultRepo.replace(updated);
}
