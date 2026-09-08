# Role C — Presentation, Export & Platform: status

**Step 00 — Build pipeline, lint, project scripts (C1):** complete.
**Step 01 — Fixture set (C2):** complete.
**Tests:** `npm test` → 319 passing (303 + 16 new). `python3 tests/run-tests.py` → 20/20.
`python3 tests/bridge-and-vision.test.py` → 10/10. `npm run lint` → 0 errors, 0 warnings.

---

## Step 01 — Fixture set (C2)

### Added

| File | Shape | Notes |
|---|---|---|
| `tests/fixtures/verification.ok.sample.json` | `VerificationResult` §5.5 | `VERIFIED`, four `*_ok` true, `details: []` |
| `tests/fixtures/verification.modified.sample.json` | `VerificationResult` | the §18 tamper payoff — `MODIFIED`, screenshot ok, metadata/manifest/signature failed, `details` = the three frozen constants |
| `tests/fixtures/verification.error.sample.json` | `VerificationResult` | `ERROR` from an *unevaluable* check (`decryption failed`); metadata/manifest/signature still `true` — proves `ERROR` ≠ all-false and ≠ `MODIFIED` |
| `tests/fixtures/record.failed-extraction.sample.json` | `StoredEvidenceRecord` §5.4 | `ai_derived_metadata.status: "failed"`, `data: null`, `platform_label: "Unknown"`; hashes + signature + encryption intact |
| `tests/fixtures/record.null-fields.sample.json` | `StoredEvidenceRecord` | extraction `ok` but `data.platform` / `contact_name` / `visible_time` / `date` all `null`, `messages: []` |
| `tests/fixtures/vault.50.sample.json` | `Array<projectListItem>` | 50 items, **newest-first** (matches `list()`'s default `sort: "newest"`), 10 calendar days, 4 platforms, verification mix (never / stale / verified / modified). No ciphertext, no `iv`, no screenshot bytes. |
| `tests/helpers/make-vault.js` | — | `makeVaultList(n=50)` — deterministic generator; the committed `vault.50` is its `n=50` output. Regenerate after editing: `node --input-type=module -e "import('./tests/helpers/make-vault.js').then(m=>require('fs').writeFileSync('tests/fixtures/vault.50.sample.json', JSON.stringify(m.makeVaultList(50),null,2)+'\n'))"` |
| `tests/helpers/ui-fixtures.js` | — | `loadUiFixture(name)`, `decodeRecord(fixture)` (base64 → `ArrayBuffer`, drops `_note`, non-mutating), `SCREENSHOT_PNG_DATA_URL` |
| `tests/ui-fixtures.test.js` | — | 16 contract checks; verification detail strings asserted against the **imported** `VERIFY_DETAILS`, never a copy |

Existing five fixtures untouched. `.sample.json` naming kept.

### Contract finding — raise with Role B before step 03

`Role C.md` §C2/§C3 assume `vaultRepo.list()` returns a **contact** field (the timeline row
shows `NK-0003  WhatsApp  Mr. ABC B  ✓ Verified`). Role B's real `projectListItem`
(`extension/src/storage/vault-repo.js`) returns **no contact** —
`{ evidence_id, created_at, platform_label, source, capture, extraction_status, last_verification }`.
The AI-derived `contact_name` lives in `manifest.ai_derived_metadata.data.contact_name`, which
`list()` does not project.

`vault.50.sample.json` and `make-vault.js` mirror the **real** projection and add no
`contact_label`. Step 03 needs one of:
1. Role B adds `contact_label` (or the whole `ai_derived_metadata.data`) to `projectListItem`; or
2. the timeline drops the contact column and shows it only in the detail view; or
3. the vault page fetches contact per-row lazily (defeats the "metadata only" goal at scale).

Recommend option 1 — a single string field, cheap, and it keeps the timeline useful. This is a
Role B contract change (3-approver PR), not a Role C local fix.

### `verified_at` dates

All verification fixtures use `2026-09-08` (the current project date) as "now" so a UI that
computes verification staleness has a stable reference. `make-vault.js` stale rows verify on the
capture day; recent rows verify 2026-09-07 / -08.

---

## Task 1 — Build strategy decision

**Chosen: Option 3 — no bundler yet (defer C1).** The extension keeps loading from
`extension/` unpacked; the vault page (step 03) is added as a plain MV3 extension page.

### Rationale

Roles A and B are already merged to `main` (303 tests) and were built with no build step.
`extension/manifest.json` (`"type": "module"`) points straight at ES-module source; every
relative import already carries a `.js` extension; there are no dynamic imports and no
framework. Current Chrome runs an ES-module MV3 service worker and `<script type="module">`
pages unpacked with no transform, so a bundler buys **nothing functional today** and would
instead be a migration that moves the load path to `dist/` for all three developers and adds
`@crxjs`-vs-Vite friction to the dev loop. The `Role C.md` §C1 "everyone is blocked until the
build lands" premise no longer holds — A and B already shipped without it — so the honest call
is to add lint + test-runner alignment now (both done) and revisit Vite only when the import
graph forces it.

### Forcing function (when this deferral must end)

**Step 07 (export)** introduces `jspdf` and `jszip` as the first *runtime* npm dependencies.
Those must either be bundled or vendored as UMD builds under `extension/src/vendor/`. Decide at
step 07: if bundling wins there, this step's Vite config (Tasks 2–3, skipped here) gets written
then, with A and B in the loop. Until then, `dist/` is reserved in `.gitignore` and there is no
`dev` / `build` script.

### Announced to

Role A and Role B — noted here as the shared record; raise at the next sync so the "no
bundler for the MVP" decision and its step-07 forcing function are acknowledged.

---

## What landed in step 00

| File | Change |
|---|---|
| `eslint.config.js` | **new** — one shared flat config. `js.configs.recommended` + `eslint-plugin-promise` + `eslint-config-prettier`, then per-area language options: `extension/**` = browser + serviceworker + webextensions globals; `tests/**` + root config = node + browser; `bridge/**` = node. |
| `.prettierrc` / `.prettierignore` | **new** — `printWidth: 100`, 2-space, semi, double-quote, no trailing comma. Ignores `node_modules`, `dist`, `package-lock.json`, `tests/fixtures`. |
| `package.json` | scripts: `lint`, `format`, `format:check`. devDeps: `eslint`, `@eslint/js`, `globals`, `eslint-config-prettier`, `eslint-plugin-promise`, `prettier`. No runtime deps added. No `dev` / `build` (see Task 1). |
| `.gitignore` | added `dist/` (reserved). |
| `vitest.config.js` | `include` now lists `tests/integration/**/*.test.js` explicitly (the existing glob already matched it) — a named home for step 08's end-to-end suite. `environment: "node"` confirmed: Node 24 here, `crypto.subtle` native. |

### Lint config choices (why the baseline is warning-free)

- `no-unused-vars`, `no-undef` → **error** (the rules that catch real MV3 bugs).
- `no-empty` → `error` with `allowEmptyCatch: true` — `try { JSON.parse(x) } catch {}` with a
  raw-text fallback is deliberate in `bridge/server.js` and `extension/src/extraction/vision-provider.js`.
- `promise/catch-or-return` → `warn` with `allowThen: true` — the worker and `lock-evidence.js`
  answer `sendMessage` with the two-arg `.then(onFulfilled, onRejected)` form, which does handle
  rejection.
- `sort-imports` → `warn` (member sort only; declaration sort ignored). Signal, not a gate;
  `eslint .` still exits 0.

### Minimal fixes applied to Role A / Role B files

Correctness-only, no logic or formatting churn (a repo-wide format pass is explicitly *not* part
of this step — see below):

| File | Fix |
|---|---|
| `bridge/server.js` | removed a dead `const duration` in the fetch-error `catch` (never read; the sibling success/warn paths do log duration — handed back to Role A as a cosmetic follow-up if they want it in the network-error log line). |
| `tests/crypto/sign.test.js` | removed an unused `jwk` / `publicKey` binding in one test (the assertion passes a literal `{ kty, crv }`). |
| `tests/verify/verifier.test.js` | removed two unused imports (`bytesToBase64`, `dataUrlToBytes`). |
| `extension/src/{evidence/lock-evidence,verify/verifier,verify/tamper-demo}.js`, `tests/{evidence/lock-evidence,verify/tamper-demo,verify/verifier}.test.js` | `eslint --fix` reordered import members alphabetically within the braces — no semantic change; `npm test` still 303 green. |

---

## Prettier: repo-wide format is a separate, approved PR — NOT this step

`npx prettier --check .` currently flags ~34 files. The codebase was hand-formatted to roughly
90–100 columns with no prior Prettier config, so **no** `printWidth` avoids a large diff; `100`
was chosen as the closest fit (fewest changed lines). Per `Role C.md` §C1, running
`prettier --write .` now would rewrite Role A's and Role B's source wholesale. That format pass
should land as its own PR that all three approve. `npm run format:check` is wired so it is a
one-command job when the team is ready.

---

## README

`README.md` load instructions ("Load unpacked → select the `extension/` directory … runs
directly from source — no build step") remain **accurate** under Option 3. No change made. When
the bundler lands (step 07 forcing function), that line changes to "select `dist/`".

---

## Step 00 Definition of Done

| # | Check | Status |
|---|---|---|
| 1 | Build strategy chosen, written here with rationale, announced to A/B | PASS — Option 3, deferred with a step-07 forcing function |
| 2 | `npm run lint` passes on the whole repo | PASS — 0 errors, 0 warnings |
| 3 | `npm test` still green (303+) | PASS — 303 vitest, 20/20 + 10/10 python |
| 4 | `README.md` load instructions match reality | PASS — unchanged, still correct for the no-build setup |
| 5 | Vitest environment exposes `crypto.subtle`; integration glob reserved | PASS |
| — | `npm run build` / `dist/` loads first try | N/A this step — deferred (Option 3); Tasks 2–3 execute at step 07 if bundling wins |

---

## Not yet started

Steps 02–08: demo page, vault shell + timeline, detail view, verification UI,
human review/edit, export, integration tests + copy audit.
