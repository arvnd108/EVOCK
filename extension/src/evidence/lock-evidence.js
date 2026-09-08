/**
 * EVOCK — lockEvidence, the evidence-core entry point (Role B).
 *
 * Role A's service-worker orchestrator calls this once per preservation:
 * capture + extraction in, one complete signed-encrypted-stored
 * StoredEvidenceRecord out. It is the seam where steps 02–06 come together.
 *
 * ATOMICITY
 * The whole record is assembled in memory and the only write is a single
 * vaultRepo.put. If any step throws, the error propagates and nothing is
 * stored — a partial record is worse than a failed capture because it looks
 * real. lockEvidence does not swallow errors; Role A owns the "screenshot-only
 * fallback" on failure.
 *
 * PIPELINE ORDER
 * hash → encrypt → build manifest → sign → timestamp → store. Encryption runs
 * before the manifest is built because the AES-GCM IV lives inside the manifest
 * (visual_artifact.encryption.iv) and is therefore covered by manifest_hash and
 * the signature.
 */

import { getSigningKeyPair, getSigningPublicKeyJwk } from "../crypto/keystore.js";
import { encryptBlob, getVaultKey } from "../crypto/encrypt.js";
import { bytesToBase64, dataUrlToBytes, sha256Bytes } from "../crypto/hash.js";
import { signManifestHash } from "../crypto/sign.js";
import { attachSignature, buildManifest } from "./manifest-builder.js";
import { nextEvidenceId } from "../shared/ids.js";
import { openDb, STORE_SETTINGS, txDone } from "../storage/db.js";
import * as vaultRepo from "../storage/vault-repo.js";
import { nowIso } from "../shared/iso-time.js";

/**
 * @param {{
 *   capture: import("../shared/types.js").CaptureResult,
 *   extraction: import("../shared/types.js").ExtractionResult,
 *   emit?: (stage: string) => void
 * }} args
 * @returns {Promise<import("../shared/types.js").StoredEvidenceRecord>}
 */
export async function lockEvidence({ capture, extraction, emit = () => {} }) {
  if (!capture || typeof capture !== "object") {
    throw new TypeError("lockEvidence: capture is required");
  }
  if (!extraction || typeof extraction !== "object") {
    throw new TypeError("lockEvidence: extraction is required");
  }

  const announce = makeAnnouncer(emit);

  // 1. Hash the screenshot from its decoded bytes, before any encryption.
  announce("hash");
  const screenshotBytes = dataUrlToBytes(capture.screenshotDataUrl);
  await sha256Bytes(screenshotBytes); // computed again inside buildManifest; called here so a bad data URL fails at the "hash" stage

  // 2. Encrypt. The IV is generated inside encryptBlob and goes into the manifest.
  announce("encrypt");
  const vaultKey = await getVaultKey();
  const { ciphertext, iv } = await encryptBlob(screenshotBytes.buffer, vaultKey);
  const iv_b64 = bytesToBase64(iv);

  // 3. Allocate the evidence id BEFORE building the manifest. The id lives
  //    inside the manifest (Building Plan §5.3) and is therefore covered by
  //    manifest_hash and the signature — it cannot be assigned after signing
  //    without invalidating both. `vault-repo.put` sees the id already set and
  //    uses it as-is rather than allocating a second one. If the later write
  //    fails, this number is simply skipped; gaps in the sequence are expected.
  const evidence_id = await allocateEvidenceId();

  const public_key_jwk = await getSigningPublicKeyJwk();
  const { manifest, manifest_hash } = await buildManifest({
    capture,
    extraction,
    evidence_id,
    iv_b64,
    public_key_jwk
  });

  // 4. Sign the manifest hash and write the signature block in.
  announce("sign");
  const { privateKey } = await getSigningKeyPair();
  const signature_b64 = await signManifestHash(manifest_hash, privateKey);
  attachSignature(manifest, { signature_b64, public_key_jwk, signed_at: nowIso() });

  // 5. The device timestamp was baked into the manifest by buildManifest and is
  //    already covered by manifest_hash and the signature. This stage is the
  //    progress marker for it.
  announce("timestamp");

  // 6. Assemble and store. One write, whole record or nothing.
  announce("store");
  /** @type {import("../shared/types.js").StoredEvidenceRecord} */
  const record = {
    evidence_id,
    manifest,
    screenshot_ciphertext: ciphertext,
    iv: iv.buffer,
    created_at: capture.capturedAt,
    platform_label: extraction.data?.platform || "Unknown",
    last_verification: null
  };

  return vaultRepo.put(record);
}

/**
 * Reserve the next evidence id in its own committed transaction, so a concurrent
 * lockEvidence call sees this number taken before it allocates its own.
 *
 * @returns {Promise<string>}
 */
async function allocateEvidenceId() {
  const db = await openDb();
  const tx = db.transaction(STORE_SETTINGS, "readwrite");
  try {
    const id = await nextEvidenceId(tx);
    await txDone(tx);
    return id;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* already settled */
    }
    throw error;
  }
}

/**
 * Wrap `emit` so a throwing progress callback can never derail the pipeline, and
 * so each stage is announced exactly once.
 *
 * @param {(stage: string) => void} emit
 * @returns {(stage: string) => void}
 */
function makeAnnouncer(emit) {
  return (stage) => {
    try {
      // A progress callback that reports over chrome.runtime.sendMessage returns
      // a promise that rejects when the popup is closed. Swallow that too — the
      // sync try/catch alone would leave it as an unhandled rejection.
      const maybePromise = emit(stage);
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(undefined, () => {});
      }
    } catch {
      /* progress reporting is best-effort */
    }
  };
}

// Re-exported so step 07's public surface is unchanged; the implementation now
// lives in shared/ so the verifier can use it without importing this whole file.
export { nowIso };
