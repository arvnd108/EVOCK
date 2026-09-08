# Role B — Evidence Core: status and handoff

**Merged:** PR #2 (`feat/role-b/test-foundation`) → `main` at `2444787`.
**Follow-up:** `feat/role-b/role-c-contract-additions` — two additive output-shape widenings for Role C (step 11).
**Tests:** `npm test` green; 310 on the Role B + Role A base, 385 with Role C's branch merged in.
**Files touched:** new modules, plus additive edits to `verifier.js` / `vault-repo.js` / `shared/types.js`. No Role A file modified.

---

## 1. Public surface

Role A and Role C import from **`extension/src/evidence/index.js`**, never the internals.

```js
import {
  lockEvidence,               // ({ capture, extraction, emit? }) -> Promise<StoredEvidenceRecord>
  verifyEvidence,             // (id, { persist = true, version? }) -> Promise<VerificationResult>
  reviseMetadata,             // (id, correctedData, { note? }) -> Promise<StoredEvidenceRecord>
  normalizeVersions,          // (record) -> RecordVersion[]  (synthesises v1 for pre-1.1 records)
  verifyManifestSignature,    // (hashHex, sigB64, jwk) -> Promise<boolean>
  reduceManifestForHashing,   // (manifest) -> reduced copy (for third-party verification)
  VERIFY_DETAILS              // frozen detail strings
} from "./evidence/index.js";
```

`vault-repo` is also public for Role C's list/detail views:

```js
import * as vaultRepo from "./storage/vault-repo.js";
// list({ sort, filter }) -> VaultListItem[] (metadata only, incl. contact_label)
// get(id) · getDecryptedScreenshot(id) -> Blob
// updateVerification(id, result) · replace(record) · remove(id) · count() · VaultQuotaError
```

Dev-only: `verify/tamper-demo.js` → `__tamperDemo(id, mode)`. Gated behind
`globalThis.__EVOCK_DEV__` / `import.meta.env.DEV`; nothing in production imports it.

---

## 2. Modules delivered

| Module | Responsibility |
|---|---|
| `evidence/canonicalize.js` | Deterministic JCS-style JSON. Zero deps. The load-bearing wall. |
| `crypto/hash.js` | `sha256Bytes` / `sha256Utf8` / `sha256Canonical`; `dataUrlToBytes`; hex + base64 codecs. |
| `evidence/manifest-builder.js` | `buildManifest`, `reduceManifestForHashing`, `attachSignature`. Owns the frozen hashing order. |
| `crypto/keystore.js` | One non-extractable ECDSA P-256 keypair per vault, persisted as a `CryptoKey`. |
| `crypto/sign.js` | `signManifestHash`, `verifyManifestSignature`, `inspectManifestSignature`, `hexToBytes`. |
| `crypto/encrypt.js` | AES-GCM 256, `getVaultKey` seam, per-record IV generated internally. |
| `crypto/timestamp.js` | `DeviceTimestampProvider` + stubbed `TrustedTimestampProvider`. |
| `storage/db.js` | IndexedDB schema v1 + promise wrappers. No `idb` dependency. |
| `storage/vault-repo.js` | The only module that reads/writes evidence records. |
| `shared/ids.js` | `nextEvidenceId(tx)` — collision-free `NK-0001` sequence. |
| `shared/iso-time.js` | `nowIso()` — ISO-8601 with local offset. |
| `verify/verifier.js` | `verifyEvidence` + frozen `VERIFY_DETAILS`. |
| `verify/tamper-demo.js` | Dev-only §18 demo harness. |

---

## 3. Frozen contracts

### Hashing order (`manifest-builder.js`, Building Plan §5.3) — frozen at `schema_version: "1.0"`

```
screenshot_hash = SHA256( dataUrlToBytes(capture.screenshotDataUrl) )   // decoded bytes, pre-encryption
metadata_hash   = SHA256( canonicalize( ai_derived_metadata ) )         // includes provider, model, status
manifest_hash   = SHA256( canonicalize( reduceManifestForHashing(manifest) ) )
                                        // manifest minus integrity.manifest_hash and signature
signature       = ECDSA-P256-SHA256( bytes of manifest_hash )
```

`evidence_id` is inside the manifest and therefore covered by `manifest_hash`.
`lockEvidence` allocates it **before** `buildManifest`; `vault-repo.put` uses the
pre-set id as-is. A failed sign/build burns an id number — sequence gaps are
expected.

### `VERIFY_DETAILS` (`verifier.js`) — Role C renders these verbatim

```js
SCREENSHOT_MISMATCH: "screenshot hash mismatch"
METADATA_MISMATCH:   "metadata hash mismatch"
MANIFEST_MISMATCH:   "manifest hash mismatch"
SIGNATURE_INVALID:   "signature invalid"
DECRYPTION_FAILED:   "decryption failed"
KEY_MALFORMED:       "public key malformed"
RECORD_NOT_FOUND:    "record not found"
```

`status` is `VERIFIED` (all four checks pass), `MODIFIED` (a comparison failed),
or `ERROR` (a check could not be evaluated). `details` is `[]` only on `VERIFIED`.

### Additive fields (step 11 — post-freeze, `1.0` → `1.1`-style, no migration)

Both are purely additive: no field removed or retyped, no hashed input changed,
no stored record rewritten (`last_verification` is stored but never hashed).

- **`VerificationResult.current_integrity`** — `{ screenshot_hash, metadata_hash,
  manifest_hash }`, each the hash **recomputed this run** or `null` where the
  check could not be evaluated. Present on every return path (happy, `MODIFIED`,
  `ERROR`, both early returns). Role C's MODIFIED panel pairs it against
  `manifest.integrity.*` (spec §18).
- **`VaultListItem.contact_label`** — the AI-derived contact name in the `list()`
  projection, `null` when extraction failed or the model returned no contact.
  Still metadata-only; it is a short string already in the deserialised record.

### Schema 1.1 — versioned records (step 12)

`StoredEvidenceRecord` gains `versions: RecordVersion[]`. A human correction to
the AI metadata does **not** overwrite the signed record — `reviseMetadata`
canonicalises, re-hashes and re-signs the corrected metadata and **appends** a
new version. The original AI version is kept and stays independently verifiable
(spec §26.4).

- Additive: `versions` is stored but never hashed — no on-disk migration. A
  pre-1.1 record has no `versions` key and is read as an implicit single "ai"
  version via `normalizeVersions`; its first revision persists the full array.
- Across every version the screenshot bytes, `integrity.screenshot_hash` and the
  IV are identical — corrections are metadata-only. Only `metadata_hash`,
  `manifest_hash`, `signature` and `signed_at` change per version.
- `record.manifest` always mirrors the latest version; `created_at` is the
  original preservation; `platform_label` / `last_verification` track the latest
  (`last_verification` resets to `null` on every revision).
- `verifyEvidence(id, { version: n })` verifies version *n*'s own manifest and
  signature; the no-arg call is unchanged. `persist` writes `last_verification`
  only on a latest-version run.
- `RecordVersion`: `{ version, origin: "ai"|"human", author: null, note: string|null,
  created_at, manifest }`.

---

## 4. Contract deviations to reconcile with Role A

| # | Issue | Proposed resolution | Status |
|---|---|---|---|
| A | `service-worker.js` emitted `provider: "unknown"` (outside §5.2). | Role A A7: `toFailedResult()` now emits a contract-valid provider id. | **Resolved (`cff7c9b`)** |
| B | `PRESERVE_STAGES` order did not match `lockEvidence`'s real emit order. | Role A A7: reordered to `capture, extract, hash, encrypt, sign, timestamp, store`. | **Resolved (`cff7c9b`)** |
| C | Capture / extraction fixtures authored by Role B from Role A's shapes. | Role A A7: re-checked field-for-field — exact. | **Resolved (`cff7c9b`)** |
| D | `shared/types.js` authored solo by Role B in step 00 (shared-ownership). | Role A A7: reviewed and accepted. | **Resolved (`cff7c9b`)** |
| E | Step 11: `current_integrity` + `contact_label` added post-freeze. | Purely additive; land as one small PR that Role A and Role C approve. | **Open — group PR** |
| F | Step 12: `versions[]` schema 1.1; worker route `MSG.REVISE_METADATA` + `GET_EVIDENCE` widening needed. | Additive schema, no migration. Worker diff below — depends on Role C's `messages.js` (`REVISE_METADATA`) landing. | **Open — group PR with Role C step 06** |

---

## 5. Proposed `service-worker.js` wiring (PR — not yet applied)

Role A owns `background/service-worker.js`. This is the diff to pair-review; it is
**not** committed on this branch.

```diff
 import { captureVisibleTab } from "../capture/capture.js";
 import { getProvider, getSelectedProviderId } from "../extraction/provider.js";
 import { MSG } from "../shared/messages.js";
+import { lockEvidence, verifyEvidence } from "../evidence/index.js";
+import * as vaultRepo from "../storage/vault-repo.js";

   if (message && message.type === MSG.PRESERVE_START) {
     (async () => {
       try {
         const captureResult = await captureVisibleTab();
         let extractionResult = null;
         try {
           /* ...existing extraction... */
         } catch (extError) {
           extractionResult = { provider: "vision", model: null,
             extractedAt: new Date().toISOString(), data: null,
             status: "failed", error: extError.message || "..." };
         }

-        sendResponse({ ok: true, message: "...", capture: captureResult, extraction: extractionResult });
+        const emit = (stage) =>
+          chrome.runtime.sendMessage({ type: MSG.PRESERVE_PROGRESS, payload: { stage, ok: true } })
+            .catch(() => {});
+        try {
+          const record = await lockEvidence({ capture: captureResult, extraction: extractionResult, emit });
+          sendResponse({ ok: true, evidence_id: record.evidence_id });
+        } catch (lockError) {
+          // Role A owns this fallback: surface a readable error; the capture is lost only if
+          // even a minimal preservation cannot be written.
+          sendResponse({ ok: false, error: lockError.message || "Preservation failed after capture" });
+        }
       } catch (error) {
         sendResponse({ ok: false, error: error.message || "Failed to capture screenshot" });
       }
     })();
     return true;
   }
+
+  if (message?.type === MSG.LIST_EVIDENCE) {
+    vaultRepo.list(message.payload || {}).then(
+      (items) => sendResponse({ ok: true, items }),
+      (err) => sendResponse({ ok: false, error: err.message }));
+    return true;
+  }
+  if (message?.type === MSG.GET_EVIDENCE) {
+    (async () => {
+      const record = await vaultRepo.get(message.payload.evidence_id);
+      if (!record) return sendResponse({ ok: false, error: "not found" });
+      const blob = await vaultRepo.getDecryptedScreenshot(message.payload.evidence_id);
+      // NOTE for Role A/C: URL.createObjectURL in an MV3 worker needs revoking and
+      // does not survive worker restart. Role C may prefer to receive the Blob.
+      sendResponse({ ok: true, manifest: record.manifest, screenshotObjectUrl: URL.createObjectURL(blob) });
+    })().catch((err) => sendResponse({ ok: false, error: err.message }));
+    return true;
+  }
+  if (message?.type === MSG.VERIFY_EVIDENCE) {
+    verifyEvidence(message.payload.evidence_id).then(
+      (result) => sendResponse({ ok: true, result }),
+      (err) => sendResponse({ ok: false, error: err.message }));
+    return true;
+  }
```

`lockEvidence` performs the vault write itself — the worker never calls
`vaultRepo.put`.

---

## 6. Definition of Done (Role B.md §7)

| # | Check | Evidence | Result |
|---|---|---|---|
| 1 | `canonicalize` deterministic across key order, unicode, restart | `tests/evidence/canonicalize.test.js` — 50 tests, incl. 10-permutation, emoji/RTL byte-stability, `vi.resetModules()` | **PASS** |
| 2 | Three hashes in the frozen order; screenshot hashed pre-encryption from decoded bytes | `manifest-builder.test.js` "hashing order" + `lock-evidence.test.js` "hashes the screenshot from decoded bytes, pre-encryption" | **PASS** |
| 3 | One signing keypair, non-extractable, public key in every manifest | `sign.test.js` "keeps the private key non-extractable" + `lock-evidence.test.js` §5.3 shape check asserts `signature.public_key_jwk` | **PASS** |
| 4 | Every record AES-GCM encrypted, unique IV in the manifest | `encrypt.test.js` "IV uniqueness" (25 distinct) + `lock-evidence.test.js` "different IV and manifest_hash on every run" | **PASS** |
| 5 | `lockEvidence` single atomic call; success writes one record, failure none | `lock-evidence.test.js` "writes nothing when a downstream step throws" / "...when signing fails after the id was allocated" — `count()` stays 0 | **PASS** |
| 6 | `verifyEvidence` → `VERIFIED` 100/100 on untouched records | `verifier.test.js` "verifies 100 times out of 100" | **PASS** |
| 7 | Every tamper-matrix entry → `MODIFIED`/`ERROR` with correct `details` | `verifier.test.js` rows 1–10 + structural-breakage + compound-failure | **PASS** |
| 8 | Exported package verifies using only the manifest's embedded public key, empty vault | `verifier.test.js` "verifies from the manifest and screenshot bytes alone" (calls `resetVault()` first) | **PASS** |
| 9 | Device time vs trusted-timestamp status separate; nothing calls device time "trusted" | `timestamp.test.js` source-scan test + `grep -rin "trusted" extension/src` — only field names / the separation rule itself | **PASS** |
| 10 | `list()` renders a 50-record vault without loading a screenshot | `vault-repo.test.js` "renders a 50-record vault as a small result" — asserts no returned item holds an `ArrayBuffer` | **PASS** |

**Known limitation (item 10):** IndexedDB has no column projection, so `list()`'s
cursor still deserialises each record transiently — peak memory is one record,
not the whole vault. A dedicated metadata store would remove even that. Out of
scope for the MVP; tracked here.

---

## 7. Outstanding

- Land step-11 (`current_integrity`, `contact_label`) — deviation E. **Merged in PR #3/#4.**
- Land step-12 (`versions[]`, `reviseMetadata`) alongside Role C step 06 — deviation F.
- Apply the `service-worker.js` diff in §8 with Role A once `MSG.REVISE_METADATA` is on `main`.

## 8. Proposed `service-worker.js` diff — step 12 (not yet applied)

Role A owns `background/service-worker.js`. `MSG.REVISE_METADATA` is defined on
Role C's step-06 branch, not yet on `main`, so this cannot land on its own.

```diff
-import { lockEvidence, verifyEvidence } from "../evidence/index.js";
+import { lockEvidence, verifyEvidence, reviseMetadata, normalizeVersions } from "../evidence/index.js";

   // inside handleMessage(...)
+  if (message?.type === MSG.REVISE_METADATA) {
+    reviseMetadata(message.payload.evidence_id, message.payload.data, { note: message.payload.note })
+      .then((record) => sendResponse({ ok: true, record }),
+            (err) => sendResponse({ ok: false, error: err?.message || "Could not save the correction." }));
+    return true;
+  }

   // GET_EVIDENCE handler — widen the response:
   sendResponse({
     ok: true,
     manifest: record.manifest,
     created_at: record.created_at,
     platform_label: record.platform_label,
     last_verification: record.last_verification,
+    versions: normalizeVersions(record),   // Role C reads res.versions; absent -> single implicit version
     screenshotDataUrl,
   });
```
