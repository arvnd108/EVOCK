# Role A — Capture & Intelligence: status

**Milestones A1–A6:** complete (see git history `A1:`…`A6:`).
**Milestone A7 — service-worker orchestrator:** complete.
**Step 13 — export wiring review:** complete (see end of file).
**Tests:** `npm test` → 468 passing. `python3 tests/run-tests.py` → 20/20.
`python3 tests/bridge-and-vision.test.py` → 10/10.

---

## A7 — what landed

`extension/src/background/service-worker.js` is now the real orchestrator. One
`PRESERVE_START` message runs the whole pipeline with no prompt in between
(Rule 3):

```
capture → extract → hash → encrypt → sign → timestamp → store
          (Role A)          └──────── lockEvidence(), Role B ────────┘
```

- **`preserve()`** — exported for tests; sequences the run and returns the
  `{ ok, evidence_id, capture, extraction, degraded }` object the popup renders.
- **`handleMessage()`** — exported; routes `PRESERVE_START`, `LIST_EVIDENCE`,
  `GET_EVIDENCE`, `VERIFY_EVIDENCE` to Role B's published functions. The last
  three are for Role C's vault UI when it lands.
- The top-level `chrome.runtime.onMessage` listener registers only when
  `globalThis.chrome` exists, so the module imports cleanly under Vitest.

### Guarantees enforced here (Role A.md §3 A7)

| Rule | Implementation |
|---|---|
| Extraction failure never throws out of the pipeline | `runExtraction()` catches everything and returns `toFailedResult(err, providerId)` — a contract-valid `status:"failed"` result. `lockEvidence` still runs. |
| Vault written once, at the end | Only `lockEvidence` writes. No partial records. |
| Screenshot-only fallback | If the first `lockEvidence` throws while extraction succeeded, it retries once with a failed-extraction stand-in (the extraction payload is the likeliest cause). If that also throws, the response is `ok:false` **with `capture` attached** so the popup still shows the bytes. |
| MV3 worker-termination guard | In-flight `{ phase, capture, extraction }` is mirrored to `chrome.storage.session`. On worker startup `resumeStrandedRun()` finishes a lock that was interrupted between capture and the vault write. |

### Popup

`popup.js` consumes the real response: the downstream checklist rows
(`hash`…`store`) are now driven by the live `PRESERVE_PROGRESS` stream and
confirmed from the response, the success banner reads `EVIDENCE PRESERVED —
NK-000n`, and a failed vault write is shown as an amber "captured but not saved"
state rather than a generic error.

---

## Role B deviations — reconciled

| # | Issue | Resolution |
|---|---|---|
| **A** | `service-worker.js` catch emitted `provider:"unknown"`; §5.2 says `"demo" \| "vision"`, and the value is hashed into `metadata_hash`. | The orchestrator now routes every failure through `toFailedResult()` (`extraction/provider.js`), which emits the attempted provider id (or `"vision"`), `status:"failed"`. `provider:"unknown"` is gone. |
| **B** | `PRESERVE_STAGES` was `capture, extract, hash, sign, timestamp, encrypt, store`; the real pipeline encrypts before signing (the AES-GCM IV must be inside the signed manifest). | `shared/messages.js` `PRESERVE_STAGES` reordered to `capture, extract, hash, encrypt, sign, timestamp, store`, matching `lockEvidence`'s emit order. Popup checklist follows the array, so it updated for free. |
| **C** | `tests/fixtures/capture.sample.json` / `extraction.ok.sample.json` were written by Role B from Role A's shapes. | Re-checked field-for-field against current `capture.js` and `schema.js` output — exact match. No change. |
| **D** | `shared/types.js` was authored solo by Role B. | Reviewed. It transcribes the frozen §5.1–§5.5 typedefs and matches `capture.js` / `schema.js` output. Accepted as-is. |

---

## Definition of done (Role A.md §7)

| # | Check | Status |
|---|---|---|
| 1 | Extension loads clean, no console errors | PASS |
| 2 | `PRESERVE EVIDENCE` produces a spec-exact `CaptureResult` on real sites | PASS (A2) |
| 3 | Preserving is one click, no dialog anywhere in the pipeline | PASS |
| 4 | AI extraction runs every time, validated/normalised; failure still yields a complete record with `status:"failed"` | PASS |
| 6 | Every AI failure mode degrades to a preserved record, never a lost capture | PASS — orchestrator tests cover extraction-throw, first-lock-throw, both-locks-throw |
| 7 | No API key in `extension/` or git history | PASS (history scrubbed; pre-commit hook blocks OpenRouter key strings) |
| 8 | Bridge binds loopback only, CORS-restricted, logs no image data | PASS (A6) |
| 9 | Progress checklist reflects real stages, not a fake animation | PASS — `PRESERVE_PROGRESS` per stage |
| 10 | `service-worker.js` calls Role B/C only through published functions | PASS — imports `evidence/index.js` and `storage/vault-repo.js` only |

---

## Step 13 — Export wiring (review of Role C step 07)

**Task A — `GET_EVIDENCE { for_export }` — RATIFIED.** The `MSG.GET_EVIDENCE`
handler now adds `screenshot_ciphertext` / `iv` (base64) to the response **only
when `payload.for_export === true`**. Additive, gated, default responses
unchanged, and the AES-GCM key is never sent. The ZIP's `screenshot.enc` needs
the raw ciphertext so the integrity chain is inspectable (spec §19 / Role C.md
§C6); the decrypted data URL is not a substitute. No dedicated `EXPORT_BUNDLE`
message — the flag on `GET_EVIDENCE` is the smaller surface. `shared/messages.js`
documents the flag.

**Task B — generation stays PAGE-SIDE.** `jsPDF` / `JSZip` load as classic
`<script>` on the vault page with no bundler; `Blob` + `chrome.downloads.download`
works from an extension page; and it sidesteps MV3 worker-lifetime limits during
a multi-hundred-KB build. The worker is asked only for data.
`MSG.EXPORT_PDF` / `MSG.EXPORT_PACKAGE` had no consumer and no handler — **retired
from `MSG`** (a comment records the worker-side route shape and where to find it
if that decision is ever revisited).

**Task C — `canonicalize` re-exported from `evidence/index.js`.** `export/
package-zip.js` now imports both `canonicalize` and `reduceManifestForHashing`
from the one public surface instead of reaching into `evidence/canonicalize.js`.

`"downloads"` permission was already in `manifest.json` — no manifest change.
`npm test` green (468 passing), `eslint .` clean.

---

## Not in Role A scope

- Vault list/detail/export UI, tamper-demo button — Role C.
- Trusted (RFC-3161) timestamping — stubbed in Role B (`crypto/timestamp.js`).
