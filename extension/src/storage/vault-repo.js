/**
 * EVOCK — evidence vault repository (Role B, B6).
 *
 * The only module that reads or writes evidence records in IndexedDB. Every
 * other part of the codebase goes through these functions.
 *
 * Design rules enforced here:
 *  - `put` is one transaction: the whole record and its id commit together, or
 *    nothing does. A half-written record is worse than a failed capture,
 *    because it looks real.
 *  - `list` returns metadata only. It walks the `by_created_at` index and
 *    projects a handful of fields per record; it never keeps a reference to a
 *    `screenshot_ciphertext`, so a 50-record vault does not pull hundreds of
 *    megabytes of image data into a list view.
 *      (IndexedDB has no column projection: a cursor still deserialises each
 *      record to read it, so one record's bytes are transiently live during its
 *      own iteration step. Peak memory is one record, not the whole vault. A
 *      dedicated metadata store would remove even that; noted for later.)
 *  - `QuotaExceededError` becomes a typed `VaultQuotaError` with a message a
 *    user can act on. Silent storage failure is unacceptable in an evidence
 *    tool.
 *
 * The promise wrappers (`openDb`, `requestToPromise`, `txDone`) live in
 * `storage/db.js` — that is the hand-rolled ~30-line IndexedDB layer; no `idb`
 * dependency.
 */

import { decryptBlob, getVaultKey } from "../crypto/encrypt.js";
import { nextEvidenceId } from "../shared/ids.js";
import {
  INDEX_BY_CREATED_AT,
  openDb,
  requestToPromise,
  STORE_EVIDENCE,
  STORE_SETTINGS,
  txDone
} from "./db.js";

/**
 * Thrown by `put` when the browser refuses the write for lack of space. Role C's
 * UI branches on this type.
 */
export class VaultQuotaError extends Error {
  constructor(message = "Local storage is full — free space or export and remove old evidence.") {
    super(message);
    this.name = "VaultQuotaError";
  }
}

/**
 * Fields `list()` exposes — see `VaultListItem` in shared/types.js. Deliberately
 * excludes `screenshot_ciphertext` and `iv`; everything here is a scalar or a
 * small sub-object already present in the deserialised record.
 *
 * `contact_label` is the AI-derived contact name (Role C's timeline row). It is
 * `null` when extraction failed or the model returned no contact.
 *
 * @param {import("../shared/types.js").StoredEvidenceRecord} record
 * @returns {import("../shared/types.js").VaultListItem}
 */
function projectListItem(record) {
  return {
    evidence_id: record.evidence_id,
    created_at: record.created_at,
    platform_label: record.platform_label,
    contact_label: record.manifest?.ai_derived_metadata?.data?.contact_name ?? null,
    source: record.manifest?.source ?? null,
    capture: record.manifest?.capture ?? null,
    extraction_status: record.manifest?.ai_derived_metadata?.status ?? null,
    last_verification: record.last_verification ?? null
  };
}

/**
 * @param {any} record
 */
function assertStorableRecord(record) {
  if (!record || typeof record !== "object") {
    throw new TypeError("vault-repo.put: expected a StoredEvidenceRecord");
  }
  if (!record.manifest || typeof record.manifest !== "object") {
    throw new TypeError("vault-repo.put: record.manifest is required");
  }
  if (!isBytes(record.screenshot_ciphertext)) {
    throw new TypeError("vault-repo.put: record.screenshot_ciphertext must be bytes");
  }
  if (!isBytes(record.iv)) {
    throw new TypeError("vault-repo.put: record.iv must be bytes");
  }
  // created_at is the `by_created_at` index key and the timeline sort key. A
  // missing value would index as `undefined` and sort unpredictably.
  if (typeof record.created_at !== "string" || record.created_at.length === 0) {
    throw new TypeError("vault-repo.put: record.created_at must be an ISO-8601 string");
  }
  if (typeof record.platform_label !== "string" || record.platform_label.length === 0) {
    throw new TypeError("vault-repo.put: record.platform_label must be a non-empty string");
  }
}

function isBytes(value) {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

function isQuotaError(error) {
  return error?.name === "QuotaExceededError";
}

/**
 * Store a new evidence record.
 *
 * If `record.evidence_id` is already set (the pipeline allocates it before
 * signing, because the id is inside the signed manifest), it is used as-is.
 * Otherwise an id is allocated with `nextEvidenceId` inside this same
 * transaction. Either way the write uses `add`, so an existing id is a hard
 * error rather than a silent overwrite.
 *
 * @param {import("../shared/types.js").StoredEvidenceRecord} record
 * @returns {Promise<import("../shared/types.js").StoredEvidenceRecord>} the stored record, id populated
 */
export async function put(record) {
  assertStorableRecord(record);

  const db = await openDb();
  const tx = db.transaction([STORE_EVIDENCE, STORE_SETTINGS], "readwrite");
  const evidence = tx.objectStore(STORE_EVIDENCE);

  try {
    let id = record.evidence_id;
    if (id === undefined || id === null || id === "") {
      id = await nextEvidenceId(tx);
    }

    const toStore = { ...record, evidence_id: id };
    await requestToPromise(evidence.add(toStore));
    await txDone(tx);
    return toStore;
  } catch (error) {
    safeAbort(tx);
    if (isQuotaError(error)) throw new VaultQuotaError();
    throw error;
  }
}

/**
 * Replace an existing record wholesale, in one transaction.
 *
 * Unlike `put` (which uses `add` and refuses to clobber), this is an update: the
 * id must already exist. Used by `reviseMetadata` to append a version — the
 * whole record, old versions included, is written or nothing is.
 *
 * @param {import("../shared/types.js").StoredEvidenceRecord} record
 * @returns {Promise<import("../shared/types.js").StoredEvidenceRecord>}
 */
export async function replace(record) {
  assertStorableRecord(record);
  if (typeof record.evidence_id !== "string" || record.evidence_id.length === 0) {
    throw new TypeError("vault-repo.replace: record.evidence_id is required");
  }

  const db = await openDb();
  const tx = db.transaction(STORE_EVIDENCE, "readwrite");
  const store = tx.objectStore(STORE_EVIDENCE);

  try {
    const existing = await requestToPromise(store.get(record.evidence_id));
    if (!existing) {
      throw new Error(`vault-repo.replace: no record "${record.evidence_id}"`);
    }
    await requestToPromise(store.put(record));
    await txDone(tx);
    return record;
  } catch (error) {
    safeAbort(tx);
    if (isQuotaError(error)) throw new VaultQuotaError();
    throw error;
  }
}

/**
 * Load one full record, ciphertext included.
 *
 * @param {string} evidence_id
 * @returns {Promise<import("../shared/types.js").StoredEvidenceRecord|undefined>}
 */
export async function get(evidence_id) {
  const db = await openDb();
  return requestToPromise(
    db.transaction(STORE_EVIDENCE, "readonly").objectStore(STORE_EVIDENCE).get(evidence_id)
  );
}

/**
 * List record metadata, newest first by default.
 *
 * @param {{ sort?: "newest"|"oldest", filter?: { platform_label?: string } }} [options]
 * @returns {Promise<import("../shared/types.js").VaultListItem[]>}
 */
export async function list({ sort = "newest", filter } = {}) {
  const db = await openDb();
  const direction = sort === "oldest" ? "next" : "prev";
  const wantedPlatform = filter?.platform_label;

  const items = [];
  await new Promise((resolve, reject) => {
    const request = db
      .transaction(STORE_EVIDENCE, "readonly")
      .objectStore(STORE_EVIDENCE)
      .index(INDEX_BY_CREATED_AT)
      .openCursor(null, direction);

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      const record = cursor.value;
      if (wantedPlatform === undefined || record.platform_label === wantedPlatform) {
        // projectListItem copies scalars and sub-objects but not the ciphertext
        // reference, so `record` (and its blob) is eligible for GC as the cursor
        // advances.
        items.push(projectListItem(record));
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });

  return items;
}

/**
 * Decrypt and return one record's screenshot.
 *
 * @param {string} evidence_id
 * @returns {Promise<Blob>}
 */
export async function getDecryptedScreenshot(evidence_id) {
  const record = await get(evidence_id);
  if (!record) {
    throw new Error(`vault-repo.getDecryptedScreenshot: no record "${evidence_id}"`);
  }

  const plaintext = await decryptBlob(record.screenshot_ciphertext, record.iv, await getVaultKey());
  const mime = record.manifest?.capture?.mime_type ?? "image/png";
  return new Blob([plaintext], { type: mime });
}

/**
 * Attach or replace a verification result on an existing record. The manifest,
 * ciphertext and every other field are read and written back untouched.
 *
 * @param {string} evidence_id
 * @param {import("../shared/types.js").VerificationResult} result
 * @returns {Promise<void>}
 */
export async function updateVerification(evidence_id, result) {
  const db = await openDb();
  const tx = db.transaction(STORE_EVIDENCE, "readwrite");
  const store = tx.objectStore(STORE_EVIDENCE);

  try {
    const record = await requestToPromise(store.get(evidence_id));
    if (!record) {
      throw new Error(`vault-repo.updateVerification: no record "${evidence_id}"`);
    }
    record.last_verification = result;
    await requestToPromise(store.put(record));
    await txDone(tx);
  } catch (error) {
    safeAbort(tx);
    if (isQuotaError(error)) throw new VaultQuotaError();
    throw error;
  }
}

/**
 * Delete one record. Explicit user action only — nothing in the pipeline calls
 * this. The id counter is not rolled back; ids are never reused.
 *
 * @param {string} evidence_id
 * @returns {Promise<void>}
 */
export async function remove(evidence_id) {
  const db = await openDb();
  const tx = db.transaction(STORE_EVIDENCE, "readwrite");
  try {
    await requestToPromise(tx.objectStore(STORE_EVIDENCE).delete(evidence_id));
    await txDone(tx);
  } catch (error) {
    safeAbort(tx);
    throw error;
  }
}

/**
 * @returns {Promise<number>} number of records in the vault
 */
export async function count() {
  const db = await openDb();
  return requestToPromise(
    db.transaction(STORE_EVIDENCE, "readonly").objectStore(STORE_EVIDENCE).count()
  );
}

/**
 * Abort a transaction without letting a double-abort (it may already be
 * aborting after the original error) throw over the real error.
 * @param {IDBTransaction} tx
 */
function safeAbort(tx) {
  try {
    tx.abort();
  } catch {
    /* already aborted or finished */
  }
}
