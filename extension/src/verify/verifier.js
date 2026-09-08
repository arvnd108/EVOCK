/**
 * EVOCK — verification engine (Role B, B7).
 *
 * Recomputes every fingerprint on a stored record and checks the signature,
 * producing a VerificationResult that names exactly what changed. The dual-hash
 * hierarchy is what lets it distinguish an altered screenshot from altered AI
 * metadata from a broken signature — far more useful to an investigator than
 * "something is wrong".
 *
 * CRITICAL: steps 3 and 4 call the SAME canonicalize / reduceManifestForHashing
 * that manifest-builder used at creation time. Re-implementing either here would
 * let the two paths drift and report MODIFIED on untouched evidence.
 *
 * verifyEvidence never rejects for a tampered or broken record — that is a
 * VerificationResult with status MODIFIED or ERROR. It only rejects if the
 * infrastructure itself fails (the vault key is unavailable, a persist write is
 * refused).
 */

import { getVaultKey, decryptBlob } from "../crypto/encrypt.js";
import { sha256Bytes, sha256Canonical } from "../crypto/hash.js";
import { inspectManifestSignature } from "../crypto/sign.js";
import { reduceManifestForHashing } from "../evidence/manifest-builder.js";
import { nowIso } from "../shared/iso-time.js";
import * as vaultRepo from "../storage/vault-repo.js";

/**
 * Detail strings, rendered verbatim by Role C's vault UI. Frozen — agree once,
 * keep stable.
 */
export const VERIFY_DETAILS = Object.freeze({
  SCREENSHOT_MISMATCH: "screenshot hash mismatch",
  METADATA_MISMATCH: "metadata hash mismatch",
  MANIFEST_MISMATCH: "manifest hash mismatch",
  SIGNATURE_INVALID: "signature invalid",
  DECRYPTION_FAILED: "decryption failed",
  KEY_MALFORMED: "public key malformed",
  RECORD_NOT_FOUND: "record not found"
});

/**
 * Verify one stored evidence record.
 *
 * @param {string} evidence_id
 * @param {{ persist?: boolean }} [options] persist writes the result onto the
 *   record's `last_verification` (default true). A persist failure propagates —
 *   a verify that claims to have stored its result but did not is misleading.
 * @returns {Promise<import("../shared/types.js").VerificationResult>}
 */
export async function verifyEvidence(evidence_id, { persist = true } = {}) {
  const verified_at = nowIso();

  const record = await vaultRepo.get(evidence_id);
  if (!record) {
    // Nothing to persist against.
    return {
      screenshot_hash_ok: false,
      metadata_hash_ok: false,
      manifest_hash_ok: false,
      signature_ok: false,
      status: "ERROR",
      details: [VERIFY_DETAILS.RECORD_NOT_FOUND],
      verified_at,
      current_integrity: { screenshot_hash: null, metadata_hash: null, manifest_hash: null }
    };
  }

  const details = [];
  let errored = false;
  const manifest = record.manifest;

  // Hashes recomputed this run, paired against manifest.integrity.* for Role C's
  // MODIFIED panel (spec §18). Stay null where a check could not be evaluated.
  let screenshot_current = null;
  let metadata_current = null;
  let manifest_current = null;

  // A manifest with no integrity or signature block is structurally broken, not
  // "modified" — there is nothing to compare against.
  if (!manifest || typeof manifest !== "object" || !manifest.integrity || !manifest.signature) {
    const result = {
      screenshot_hash_ok: false,
      metadata_hash_ok: false,
      manifest_hash_ok: false,
      signature_ok: false,
      status: "ERROR",
      details: [VERIFY_DETAILS.MANIFEST_MISMATCH],
      verified_at,
      current_integrity: { screenshot_hash: null, metadata_hash: null, manifest_hash: null }
    };
    if (persist) await vaultRepo.updateVerification(evidence_id, result);
    return result;
  }

  // ---- 2. Screenshot -------------------------------------------------------
  let screenshot_hash_ok = false;
  try {
    const plaintext = await decryptBlob(
      record.screenshot_ciphertext,
      record.iv,
      await getVaultKey()
    );
    const recomputed = await sha256Bytes(plaintext);
    screenshot_current = recomputed;
    screenshot_hash_ok = recomputed === manifest.integrity.screenshot_hash;
    if (!screenshot_hash_ok) details.push(VERIFY_DETAILS.SCREENSHOT_MISMATCH);
  } catch {
    // Wrong key, corrupt ciphertext, missing ciphertext/iv — all unevaluable.
    errored = true;
    details.push(VERIFY_DETAILS.DECRYPTION_FAILED);
  }

  // ---- 3. Metadata -------------------------------------------------------
  let metadata_hash_ok = false;
  try {
    const recomputed = await sha256Canonical(manifest.ai_derived_metadata);
    metadata_current = recomputed;
    metadata_hash_ok = recomputed === manifest.integrity.metadata_hash;
    if (!metadata_hash_ok) details.push(VERIFY_DETAILS.METADATA_MISMATCH);
  } catch {
    // ai_derived_metadata holds a value canonicalisation refuses (a Date, a
    // function) — the manifest is broken, not merely altered.
    errored = true;
    details.push(VERIFY_DETAILS.METADATA_MISMATCH);
  }

  // ---- 4. Manifest -------------------------------------------------------
  let manifest_hash_ok = false;
  try {
    const recomputed = await sha256Canonical(reduceManifestForHashing(manifest));
    manifest_current = recomputed;
    manifest_hash_ok = recomputed === manifest.integrity.manifest_hash;
    if (!manifest_hash_ok) details.push(VERIFY_DETAILS.MANIFEST_MISMATCH);
  } catch {
    errored = true;
    details.push(VERIFY_DETAILS.MANIFEST_MISMATCH);
  }

  // ---- 5. Signature ----------------------------------------------------
  // Verified against the key embedded in the manifest, never the local keystore,
  // so an exported package verifies on a machine that has never seen this vault.
  const sig = await inspectManifestSignature(
    manifest.integrity.manifest_hash,
    manifest.signature.signature,
    manifest.signature.public_key_jwk
  );
  const signature_ok = sig.ok;
  if (!signature_ok) {
    details.push(
      sig.reason === "key_malformed"
        ? VERIFY_DETAILS.KEY_MALFORMED
        : VERIFY_DETAILS.SIGNATURE_INVALID
    );
  }

  // ---- 6. Aggregate --------------------------------------------------
  let status;
  if (errored) {
    status = "ERROR";
  } else if (screenshot_hash_ok && metadata_hash_ok && manifest_hash_ok && signature_ok) {
    status = "VERIFIED";
  } else {
    status = "MODIFIED";
  }

  /** @type {import("../shared/types.js").VerificationResult} */
  const result = {
    screenshot_hash_ok,
    metadata_hash_ok,
    manifest_hash_ok,
    signature_ok,
    status,
    details: status === "VERIFIED" ? [] : dedupe(details),
    verified_at,
    current_integrity: {
      screenshot_hash: screenshot_current,
      metadata_hash: metadata_current,
      manifest_hash: manifest_current
    }
  };

  if (persist) await vaultRepo.updateVerification(evidence_id, result);
  return result;
}

/**
 * @param {string[]} list
 * @returns {string[]}
 */
function dedupe(list) {
  return [...new Set(list)];
}
