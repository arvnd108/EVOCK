/**
 * EVOCK — tamper demo harness (Role B, B8). DEV BUILDS ONLY.
 *
 * Modifies a stored evidence record the way an attacker editing the vault file
 * would: a raw IndexedDB write that changes content WITHOUT recomputing any
 * hash. It keeps an untouched backup so the change can be reversed byte-for-byte.
 *
 * This drives the single most persuasive 30 seconds of the walkthrough
 * (EVOCK spec §18):
 *
 *   __tamperDemo("NK-0001", "modify_metadata")
 *   verifyEvidence("NK-0001")   -> MODIFIED   ["metadata hash mismatch"]
 *   __tamperDemo("NK-0001", "restore")
 *   verifyEvidence("NK-0001")   -> VERIFIED
 *
 * It must never ship. The runtime guard below throws in a production build, and
 * nothing in the production service worker imports this module, so a bundler
 * drops it entirely.
 */

import { decryptBlob, encryptBlob, getVaultKey } from "../crypto/encrypt.js";
import {
  openDb,
  requestToPromise,
  STORE_EVIDENCE,
  STORE_SETTINGS,
  txDone
} from "../storage/db.js";

const BACKUP_PREFIX = "__tamper_backup__";

/**
 * True only in a development build.
 *
 * TODO(role-c): confirm the dev flag name Vite exposes. An explicit boolean on
 * globalThis wins (tests and manual toggling); otherwise fall back to
 * import.meta.env.DEV.
 *
 * @returns {boolean}
 */
function isDevBuild() {
  if (typeof globalThis.__EVOCK_DEV__ === "boolean") return globalThis.__EVOCK_DEV__;
  try {
    return import.meta.env?.DEV === true;
  } catch {
    return false;
  }
}

/**
 * @param {string} evidence_id
 * @param {"modify_metadata"|"modify_screenshot"|"restore"} mode
 * @returns {Promise<{ ok: true, mode: string }>}
 */
export async function __tamperDemo(evidence_id, mode) {
  if (!isDevBuild()) {
    throw new Error("__tamperDemo is disabled in production builds");
  }

  switch (mode) {
    case "modify_metadata":
      await modifyMetadata(evidence_id);
      return { ok: true, mode };
    case "modify_screenshot":
      await modifyScreenshot(evidence_id);
      return { ok: true, mode };
    case "restore":
      await restore(evidence_id);
      return { ok: true, mode };
    default:
      throw new Error(`__tamperDemo: unknown mode "${mode}"`);
  }
}

/**
 * Read a record straight from the store — no integrity checks, no vault-repo.
 * @param {string} evidence_id
 * @returns {Promise<import("../shared/types.js").StoredEvidenceRecord>}
 */
async function rawGet(evidence_id) {
  const db = await openDb();
  const record = await requestToPromise(
    db.transaction(STORE_EVIDENCE, "readonly").objectStore(STORE_EVIDENCE).get(evidence_id)
  );
  if (!record) {
    throw new Error(`__tamperDemo: no record "${evidence_id}"`);
  }
  return record;
}

/**
 * Write the (possibly modified) record back, and store the original as a backup
 * only if one is not already held — so a second modification before a restore
 * leaves the FIRST (pristine) backup in place.
 *
 * The backup presence is checked in a prior read rather than via `add` +
 * ConstraintError: an unhandled request error aborts its whole transaction
 * (IndexedDB semantics that fake-indexeddb enforces), which would roll the
 * record write back too. This is a single-user dev harness driven by button
 * clicks, so the read/write gap is not a real race.
 *
 * @param {import("../shared/types.js").StoredEvidenceRecord} modified the record to store
 * @param {import("../shared/types.js").StoredEvidenceRecord} pristine the untouched record to back up
 */
async function writeWithBackup(modified, pristine) {
  const db = await openDb();
  const backupKey = BACKUP_PREFIX + pristine.evidence_id;

  const existingBackup = await requestToPromise(
    db.transaction(STORE_SETTINGS, "readonly").objectStore(STORE_SETTINGS).get(backupKey)
  );

  const tx = db.transaction([STORE_EVIDENCE, STORE_SETTINGS], "readwrite");
  try {
    tx.objectStore(STORE_EVIDENCE).put(modified);
    if (!existingBackup) {
      tx.objectStore(STORE_SETTINGS).put({ key: backupKey, value: pristine });
    }
    await txDone(tx);
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
 * @param {string} evidence_id
 */
async function modifyMetadata(evidence_id) {
  const pristine = await rawGet(evidence_id);
  const modified = structuredClone(pristine);

  const data = modified.manifest?.ai_derived_metadata?.data;
  if (data?.messages?.length && typeof data.messages[0].text === "string") {
    data.messages[0].text += "!";
  } else if (data && typeof data.contact_name === "string") {
    data.contact_name += " (edited)";
  } else if (data) {
    data.tamper_demo_field = "changed";
  } else {
    // No derived data at all (a failed extraction). Alter the provenance line.
    modified.manifest.ai_derived_metadata.model =
      `${modified.manifest.ai_derived_metadata.model ?? ""}-edited`;
  }

  // integrity.* is deliberately left untouched — that is the whole point.
  await writeWithBackup(modified, pristine);
}

/**
 * @param {string} evidence_id
 */
async function modifyScreenshot(evidence_id) {
  const pristine = await rawGet(evidence_id);

  const key = await getVaultKey();
  const plaintext = new Uint8Array(
    await decryptBlob(pristine.screenshot_ciphertext, pristine.iv, key)
  );

  // XOR-0xff is never a fixed point, so byte 0 is guaranteed to change. An empty
  // screenshot (which cannot occur for a real capture) gets a one-byte payload.
  const flipped = plaintext.length === 0 ? new Uint8Array([0xff]) : plaintext;
  flipped[0] ^= 0xff;

  // Re-encrypt with a fresh IV so the record still DECRYPTS cleanly — verify
  // must reach a "screenshot hash mismatch", not a "decryption failed" ERROR.
  const { ciphertext, iv } = await encryptBlob(flipped, key);

  const modified = structuredClone(pristine);
  modified.screenshot_ciphertext = ciphertext;
  modified.iv = iv.buffer;
  // integrity.screenshot_hash is left as-is.

  await writeWithBackup(modified, pristine);
}

/**
 * @param {string} evidence_id
 */
async function restore(evidence_id) {
  const db = await openDb();
  const backupKey = BACKUP_PREFIX + evidence_id;

  const backup = await requestToPromise(
    db.transaction(STORE_SETTINGS, "readonly").objectStore(STORE_SETTINGS).get(backupKey)
  );
  if (!backup) {
    return; // nothing to undo
  }

  const tx = db.transaction([STORE_EVIDENCE, STORE_SETTINGS], "readwrite");
  try {
    tx.objectStore(STORE_EVIDENCE).put(backup.value);
    tx.objectStore(STORE_SETTINGS).delete(backupKey);
    await txDone(tx);
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* already settled */
    }
    throw error;
  }
}
