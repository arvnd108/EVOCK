# Role C — Presentation, Export & Platform: status

**Step 00 — Build pipeline, lint, project scripts (C1):** complete.
**Step 01 — Fixture set (C2):** complete.
**Step 02 — Static demo chat page (C7):** complete.
**Step 03 — Vault shell and chronological timeline (C3, part 1):** complete.
**Step 04 — Evidence detail view (C3, part 2):** complete.
**Step 05 — Verification UI (C5):** complete.
**Step 06 — Human review / edit of AI metadata (C4):** complete.
**Step 07 — Export: human-readable PDF + machine-readable package (C6):** complete.
**Step 08 — Integration tests, copy audit, demo script, README (C8):** complete.
**Tests:** `npm test` → 470 passing (+2 integration). `python3 tests/run-tests.py` → 20/20.
`python3 tests/bridge-and-vision.test.py` → 10/10. `npm run lint` → 0 errors, 0 warnings.

## Contract items resolved by Role B

- **`contact_label` on `list()`** (asked at step 03) — **landed** in `4f6960b` (Role B step 11).
  `projectListItem` now returns it; the timeline shows real contact names. Role C's
  "unknown account" fallback stays as defensive code.
- **`current_integrity` on `VerificationResult`** (asked at step 05) — **landed** in `4f6960b`.
  `verifyEvidence` returns the recomputed hashes on every path; the MODIFIED verify panel shows a
  real recorded-vs-current pair. Role C's "not reported by the verifier" fallback stays defensive.

## Contract items open (asked at step 06 — `Role B Prompts/12`)

- `versions[]` on `StoredEvidenceRecord` + `reviseMetadata()` in `evidence/index.js`.
- `REVISE_METADATA` worker route (added to `MSG` already); `GET_EVIDENCE` returning `versions`.
- `verifyEvidence(id, { version })` to verify a specific past version.

Until they land, the review editor opens and validates but a save fails gracefully ("The
correction was not saved…"), and the detail view renders every record as a single implicit
version.

---

## Step 05 — Verification UI (C5)

### Added

| File | Notes |
|---|---|
| `extension/src/vault/components/verify-panel.js` | `renderVerifyPanel(result, { manifest })` — VERIFIED / MODIFIED / ERROR as three visually distinct states (green / red / neutral amber). MODIFIED shows the **recorded-vs-current hash pair** side by side (monospace, aligned — spec §18), a one-liner naming the changed field (built from the `*_ok` booleans, referencing the record's creation date), the per-field ✓/❌ row, and the `details[]` strings **verbatim**. `HONEST_FOOTER` on every state. `createVerifyPanel({ verifyApi, onResult })` → `{ element, run(id,{manifest}), close() }`; `chromeVerifyApi` = one `VERIFY_EVIDENCE` round-trip. No `evidence/` or `crypto/` import; a test asserts `crypto.subtle.digest` is never called. |
| `tests/vault/verify-panel.test.js` | 14 jsdom tests: the three states, the side-by-side hash pair sourced from data (recorded ← manifest, current ← result), per-field row matching the booleans, verbatim details, footer on all states, deterministic/pure render, and the `createVerifyPanel` run / transport-error / close paths. |

### Changed

- `vault.css` — `.nk-verify*` classes (`--verified` green / `--modified` red / `--error` amber, the `.nk-verify__hashes` two-line block, checks row, footer).
- `detail-panel.js` — `[Verify]` now calls `onVerify(id, manifest)` (manifest passed so the panel can source recorded hashes); step-04 tests unaffected (they don't invoke `onVerify`).
- `vault.js` — `initVault` now also returns `applyVerification(id, result)` (folds a fresh result into the in-memory list and repaints the timeline pill without a re-fetch). The auto-bootstrap wires a verify panel below the detail panel: `[Verify]` → `verify.run(id, { manifest })` → `onResult` → `applyVerification`.

### Contract ask for Role B — recomputed hashes on `VerificationResult`

Spec §18 / Role C.md §C5 need the **current** (recomputed) hash beside the recorded one.
`VerificationResult` (§5.5) does not carry it, and Role C **must not** recompute hashes in the
UI (§C5, "do not derive it locally"). Proposed minimal addition, mirroring `manifest.integrity`:

```jsonc
"current_integrity": {
  "screenshot_hash": "<hex>",   // what the verifier recomputed this run
  "metadata_hash":   "<hex>",
  "manifest_hash":   "<hex>"
}
```

The verifier already computes each `recomputed` value next to `manifest.integrity.X`
(`verify/verifier.js` steps 2–4), so this is a pass-through, not new work.
`verification.modified.sample.json` carries `current_integrity` now so the panel is testable and
demoable; when it is **absent** the panel renders the recorded hash and shows
"not reported by the verifier" for the current slot — never a locally-derived value.

---

## Step 04 — Evidence detail view (C3, part 2)

### Added

| File | Notes |
|---|---|
| `extension/src/vault/components/detail-panel.js` | `createDetailPanel({ detailApi, onVerify, onExport, onClose })` → `{ element, show(id), close() }`. `chromeDetailApi` = one `GET_EVIDENCE` round-trip. Header (id + Verify / Export ▾ / Close), screenshot, derived-metadata block, capture context (incl. **Device time**), integrity block. `formatDeviceTime()` renders the ISO instant + offset locale-independently. |
| `extension/src/vault/components/derived-metadata-block.js` | **Honesty rule 1.** Tinted `.nk-derived` panel, always-on-screen "AI-derived metadata" label, ⓘ affordance + a plain-text note that a vision model can misread names/timestamps/small text (spec §25.1). Failed extraction → calm "AI extraction unavailable — no derived metadata for this record", never "failed capture". Null platform/contact → Unknown / unknown account; empty messages → "No message text extracted". |
| `extension/src/vault/components/integrity-block.js` | Three SHA-256 hashes, each truncated in the row, full value in `title` + on the Copy button (Clipboard API; never logged, never in a URL). Signature `✓ ECDSA P-256`, **Trusted timestamp** on its own row (`not_configured` → "Not configured", never hidden, never folded into Device time — **honesty rule 2**, spec §25.11), Encryption `✓ AES-GCM 256`. |
| `tests/vault/detail-panel.test.js` | 13 jsdom tests: full render, two-separate-rows check, failed-extraction, null-fields, object-URL created-on-show / revoked-on-close / 20× no-leak / revoked-before-renavigate, and "no hash reaches console.* or an href/src". |

### Changed

- `vault.css` — `.nk-detail*`, `.nk-derived*`, `.nk-integrity*`, `.nk-kv*`, `.nk-copy` classes; four `--nk-caution*` tokens for the AI-derived tint (kept in the shared `:root` block).
- `vault.html` — a `#vault-detail` mount after `#vault-body`.
- `vault.js` — the auto-bootstrap now creates a detail panel and opens it on row click (scrolls it into view); `initVault`'s signature and tests are unchanged.

### Decisions / findings

- **Screenshot transport — resolved, not open.** `docs/role-b-status.md` §5 worried about a worker-side `URL.createObjectURL`. Role A already switched `GET_EVIDENCE` to return a base64 `screenshotDataUrl` (see the comment in `background/service-worker.js`). The panel converts that to a `Blob`, creates **its own** object URL for the `<img>`, and revokes it on close / re-navigate — so every detail-view object URL is released (Task 6, DoD).
- **Verify / Export buttons are present but inert.** Wiring lands in step 05 (`onVerify`) and steps 06–07 (`onExport`). The bootstrap does not pass those callbacks yet.
- Contact still comes from `manifest.ai_derived_metadata.data.contact_name` here (the detail view has the full manifest), so the timeline's `contact_label` gap does not affect this screen.

---

## Step 03 — Vault shell and chronological timeline (C3, part 1)

### Added

| File | Notes |
|---|---|
| `extension/src/vault/vault.html` | Full extension page. Header + count, `#vault-filters`, `#vault-body[data-vault-autoinit]`. No inline script (MV3 extension-page CSP); the controller auto-boots from `vault.js` off the `data-vault-autoinit` marker. |
| `extension/src/vault/vault.css` | **Shared layer:** `:root` design tokens (`--nk-*`) + the `.nk-pill` ✓/⚠/❌/— status treatment — imported by the popup so the two surfaces cannot drift. Plus `.nk-*` vault layout (no bare-element selectors, no `body{}`, so it is safe alongside `popup.css`). |
| `extension/src/vault/vault.js` | `initVault(mount, { vaultApi, now, onSelect })`. Fetches once via the `vaultApi` seam (`chromeVaultApi` → `LIST_EVIDENCE`, unwraps `{ ok, items }`), applies filter/sort client-side, paints count + filters + timeline. `assertNoCiphertext()` throws if `list()` ever returns screenshot bytes. Never imports `vaultRepo`, never decrypts. |
| `extension/src/vault/components/record-card.js` | One row (id · platform · contact · pill) as a `<button>`; click → `onSelect(id)` **and** a bubbling `vault:select` CustomEvent. `verificationPill()` + locale-independent `formatDay()`. |
| `extension/src/vault/components/timeline.js` | `groupByDay()` (order-preserving) + `renderTimeline()` — day header per calendar day, newest group first. |
| `extension/src/vault/components/filters.js` | Pure `applyFilters(items, state, {now})` + `renderFilters()` controls (platform checkboxes, date range, verification `<select>`, sort). `platformsPresent()`, `defaultFilterState()`. |
| `extension/src/vault/components/empty-state.js` | `renderEmptyState()` — what the vault is for + how a record gets here. §36-clean copy. |
| `tests/vault/{record-card,timeline,filters,vault}.test.js` | 39 tests, jsdom (`// @vitest-environment jsdom`; `jsdom` added as a devDep). Cover grouping, counts, empty + null-field states, filter/sort narrowing, click wiring, the "no decrypt / one fetch" contract, and a 50-row render budget. |

### Changed (Role A files — minimal, coordinated per Task 1 & Task 6)

- `extension/src/popup/popup.html` — one `<link rel="stylesheet" href="../vault/vault.css">` before `popup.css`, so the popup gets the shared tokens + pill classes.
- `extension/src/popup/popup.js` — the existing (stubbed) **Open Vault** button now does
  `chrome.tabs.create({ url: chrome.runtime.getURL("src/vault/vault.html") })`. (`chrome.tabs.create` needs no `"tabs"` permission.)

### Decisions

- **Verification pill has five states, not the three in Task 3.** Task 3 lists `✓ Verified / ⚠ Not verified since <date> / — Never verified`. The fixtures (and reality) also produce a `MODIFIED` and an `ERROR` `last_verification`; hiding a tamper result behind a soft "⚠" would violate the honesty principle, so the pill adds `❌ Modified` and `⚠ Could not verify`, and the verification filter offers the matching options. Task 1's "✓ / ⚠ / ❌ treatment" already anticipates ❌.
- **Staleness is injectable.** `verificationPill` / `applyFilters` take `now` (default `Date.now()`), `staleAfterDays` default 7. Tests pin `now` to 2026-09-08 for determinism.
- **`contact_label` added to the fixtures + generator.** Step 01 flagged that the real `projectListItem` has no contact field. Rather than ship a timeline whose contact column is uniformly "unknown account", `make-vault.js` and `vault.50.sample.json` now carry `contact_label` (the recommended Role B addition; some rows deliberately `null`). `record-card.js` reads `item.contact_label` and still falls back to "unknown account" when the field is absent — which is what production `list()` returns until **Role B adds `contact_label` to `projectListItem`** (open contract item, unchanged recommendation).
- **No manifest change.** `vault.html` is an extension-owned page opened by the extension itself; MV3 needs no `web_accessible_resources` entry for that. Still no bundler (step 00), so nothing copies `vault/` anywhere.

### Verified in a browser

Served over `http://127.0.0.1`, fed `initVault` a fake `vaultApi`: renders the grouped timeline, count, filter bar; changing the verification filter narrows to the right rows without a re-fetch; the empty state renders with no filter bar; zero `<img>` elements; console clean. Loaded raw (no `chrome` API) the page shows a graceful "Could not load the vault" box rather than a blank screen or an unhandled rejection.

---

## Step 02 — Static demo chat page (C7)

### Added

| File | Notes |
|---|---|
| `demo/chat.html` | Zero JavaScript, one relative stylesheet, no images, no web fonts, no network requests. Renders a generic messaging screen: fictional-sample banner, header (contact `Mr. ABC B`, CSS monogram avatar — no image), a `1 September 2026` day separator, two incoming bubbles carrying the tamper-demo strings **verbatim** (`Don't try to hide.` / `I know where you live.`) each stamped `11:28 PM`, and an inert disabled composer. |
| `demo/chat.css` | Neutral slate palette — deliberately not any real product's colours. Fixed dimensions (420 × 560 card, fixed header/composer heights), no animations, no `transition`, no `@font-face`, system font stack only, so layout boxes are machine-independent (only glyph anti-aliasing can differ across OSes, which does not change dimensions or structure). |

Content matches `docs/EVOCK.md` §9's example input exactly, so extraction output is
predictable, and §18's tamper text is present for the record-alteration demo.

### Decisions

- **`demo/chat-tampered.html` (optional) — not added.** The prompt leans against it and the
  real §18 demo alters the *stored record* via `__tamperDemo`, not the page; a second HTML file
  would only invite "which one do I capture?" confusion in the demo script.
- **No manifest change.** The page is opened in an ordinary browser tab (`file://` or a static
  server) and then Preserved — it is not loaded inside the extension, so it needs no
  `web_accessible_resources` entry. This step's diff is confined to `demo/`.
- The extension still has no bundler (step 00, Option 3), so `demo/` is not copied anywhere —
  it is served/opened from the repo as-is.

### Verified

Served over `http://127.0.0.1` and loaded in a browser: renders as intended, network panel
shows only `chat.html` + `chat.css` (both local), console is clean. `npm run lint` ignores
`demo/` (not in an ESLint glob; no JS anyway); `npx prettier --check demo/` is clean.

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

**RESOLVED at step 07 — still no bundler.** `jspdf` / `jszip` are in `dependencies` for the
test run, and their browser builds are **vendored** to `extension/src/vendor/`
(`jspdf.umd.min.js`, `jszip.min.js`, ~510 KB) and loaded as classic `<script>` tags by
`vault/vault.html`. Export generation runs **on the vault page**, not in the module service
worker, so the classic-script path is all that is needed. The export builders read the library
off `globalThis` through an injectable seam, so Vitest imports the npm package and never touches
the vendored files. `extension/src/vendor/README.md` documents regeneration. If the import graph
later forces a bundler, deleting the folder + two `<script>` tags is the whole rollback.

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

## Step 06 — Human review / edit of AI metadata (C4)

### Task 0 decision — versioned-record shape

**Chosen: `versions[]` inside the record (Option A), not separate linked records.** One
`StoredEvidenceRecord` stays one timeline row; the encrypted screenshot is stored once and shared
by every version; `created_at` (the timeline anchor) never moves. Full shape and the re-sign
contract are in `Role B Prompts/12-versioned-records-and-revise.md`. `record.manifest` always
mirrors the latest version; `last_verification` resets to `null` on every revision.

### Added

| File | Notes |
|---|---|
| `extension/src/vault/components/review-editor.js` | `renderReviewEditor(data, {onSave,onCancel})` — the correction form (platform, contact, per-message sender/text/timestamp, visible time, date, optional reason). `renderVersionHistory(versions, {selected,onSelect})` — the v1/v2 list with origin (AI-derived / Human-corrected), signed time, "✓ signed". `createReviewController({reviseApi,onRevised})` — open → edit → `reviseApi.revise(id, data, {note})`; on success `onRevised` + close, on failure the versions are untouched and "The correction was not saved: …" is shown. `chromeReviseApi` = one `REVISE_METADATA` round-trip. Role C signs nothing. |
| `tests/fixtures/record.versioned.sample.json` | `StoredEvidenceRecord` + `versions: [v1(ai), v2(human)]` in the Task 0 shape; `screenshot_hash` identical across versions. |
| `tests/vault/review-editor.test.js` | 15 jsdom tests — editor prefill/save/cancel/blank, version history rows + selection + click, controller success/failure/cancel, and the version-aware detail panel (defaults to latest, switch to v1 shows original text, screenshot hash equal across versions, `[Edit metadata]` only on the latest, single-version record has no history section). |

### Changed

- `shared/messages.js` — `MSG.REVISE_METADATA` (`{ evidence_id, data, note } → { ok, record }`).
- `derived-metadata-block.js` — optional `{ onEdit }` → an `[Edit metadata]` control.
- `detail-panel.js` — version-aware: `normalizeVersions(res)` (a pre-`versions[]` record becomes one implicit version), a "Versions" section when there is more than one, a version switcher that re-renders the body **without** a re-fetch or a new object URL, `[Edit metadata]` wired only for the latest version, new opt `onEditMetadata`.
- `record-card.js` — now also owns `formatDeviceTime` (moved from `detail-panel.js`, which re-exports it) so `review-editor.js` / `verify-panel.js` share it without importing from `detail-panel.js` (avoids an import cycle).
- `vault.js` — the bootstrap mounts a review controller below the verify panel; `[Edit metadata]` opens it, and `onRevised` re-shows the record and marks its timeline pill unverified.
- `vault.css` — `.nk-versions*`, `.nk-review*`, `.nk-derived__edit` classes.

### Decisions / known limits

- **Pre-lock review gate (Task 1) skipped.** The pipeline is strictly one click, no dialog
  (Principle 5; `docs/role-a-status.md` DoD #3). Review happens only from the detail view.
- **Editor edits existing message rows in place** — no add/remove-message UI (out of Task 2's
  scope, which lists editing the current fields).
- **Verify still verifies the latest version.** Per-version verification needs
  `verifyEvidence(id, { version })` — a Role B ask in prompt 12.
- Both stale contract notes from steps 03 and 05 have been trimmed from the component comments now
  that Role B step 11 has landed.

---

## Step 07 — Export: human-readable PDF + machine-readable package (C6)

### Bundler decision (step-00 forcing function) — resolved: still no bundler

`jspdf@4.2.1` + `jszip@3.10.1` are in `dependencies`. Their browser builds are **vendored** to
`extension/src/vendor/` and loaded as classic `<script>` in `vault/vault.html`. Export runs on the
vault page, so that is sufficient — a module service worker never needs the libraries. Builders
resolve the library off `globalThis` via an injectable seam; Vitest imports the npm package
instead. Verified in a browser: `window.jspdf.jsPDF` and `window.JSZip` are defined, and both
builders produce valid output (PDF `%PDF-`, 4 pages, Limitations page; ZIP `PK`, all six entries).

### Added

| File | Notes |
|---|---|
| `extension/src/export/pdf-report.js` | `buildPdfReport({ record, verification, screenshotDataUrl }, { jsPDF })` → `{ bytes, text, pages }`. Every spec §19 field in order (`PDF_SECTIONS`); the four AI-derived fields carry an `[AI-derived]` marker + a misread note; "Device capture time" is never called "timestamp"; trusted-timestamp `not_configured` → "Not configured" plainly; **Limitations on its own final page** — `CAN_SHOW` (§27) + `CANNOT_ESTABLISH` (§27/§36), un-trimmed. `text` is the pre-wrap logical lines so tests can scan content/order/copy without a PDF parser. Filename `EVOCK-<id>-report.pdf`. |
| `extension/src/export/package-zip.js` | `buildPackageZip({ record, verification }, { JSZip })` → `Uint8Array`. Six entries under `NK-XXXX/`: `manifest.json` = `canonicalize(reduceManifestForHashing(manifest))` (byte-identical to the vault's `manifest_hash` preimage — the test asserts equality), `screenshot.enc` (raw ciphertext via `toBytes`, handles ArrayBuffer / base64 / Uint8Array), `signature.sig`, `public-key.jwk`, `verification.json`, `README.txt`. Filename `EVOCK-<id>-package.zip`. |
| `extension/src/export/verify-readme.txt.js` | `buildVerifyReadme({ evidence_id })` → the package README. Carries `HASHING_RECIPE` (the four Building Plan §5.3 lines, verbatim), the byte-level clarifications the one-liners leave implicit (32 raw digest bytes, P1363 r‖s signature, canonical-JSON definition), a Python `cryptography` worked example, the KEY HANDLING note (AES key not included, by design), and `CANNOT_ESTABLISH`. |
| `extension/src/vault/components/export-controller.js` | The vault-page menu under **Export ▾**: two buttons (PDF / ZIP) + a status line. `chromeExportApi.getForExport` = one `GET_EVIDENCE { for_export: true }` round-trip; `chromeDownloader.save` = `Blob` → `chrome.downloads.download`. `busy` guard; failures surface in the status line, never throw; ZIP without ciphertext fails gracefully pointing at `Role A Prompts/13`. All seams injectable. |
| `extension/src/vendor/{jspdf.umd.min.js,jszip.min.js,README.md,VERSIONS.txt}` | Vendored browser builds + provenance/regeneration notes. |
| `tests/export/{pdf-report,package-zip,verify-readme,copy-audit,export-controller}.test.js` | 43 tests. PDF: real bytes, all 12 sections in order, AI-derived marks, full hashes, failed-extraction still renders + Limitations. ZIP: six entries, `manifest.json` byte-match, raw ciphertext, README recipe verbatim, `verification.json` round-trip. Copy audit: greps `admissib|proves|guarantee|locally|recover` across both PDF fixtures + README, every hit must sit in a negated sentence → zero bare hits. Controller: menu, PDF/ZIP download filenames + mime, graceful load failure, double-click guard. |

### Changed

- `background/service-worker.js` — `GET_EVIDENCE` returns `screenshot_ciphertext` / `iv` (base64)
  **only when `payload.for_export === true`**. One small, additive change; the ZIP needs the raw
  ciphertext and the decrypted data URL is not enough. Ratification + the worker-side alternative
  are in `Role A Prompts/13`.
- `shared/messages.js` — `MSG.GET_EVIDENCE` doc notes the `for_export` flag.
- `vault/vault.html` — two vendored `<script>` tags before the module.
- `vault/vault.js` — the bootstrap mounts an export controller under the review controller and
  wires the detail panel's `onExport`.
- `vault/vault.css` — `.nk-export*` classes.
- Pre-existing lint tidied (correctness-only, step-00 precedent): 4 unused imports in
  `tests/evidence/revise-metadata.test.js` (Role B step 12) and a `sort-imports` warning in
  `service-worker.js`'s `evidence/index.js` import (Role A/B merge). `npm run lint` → 0/0 again.

### Decisions / known limits

- **Generation is page-side, not worker-side.** `MSG.EXPORT_PDF` / `MSG.EXPORT_PACKAGE` stay
  defined but unused; `Role A Prompts/13` asks Role A to ratify or route them.
- **The ZIP needs `for_export`.** Until Role A ratifies (or replaces) the `GET_EVIDENCE` change,
  the PDF export works unchanged and the package export shows a plain "not yet" message.
- **`canonicalize` is imported from `evidence/canonicalize.js` directly** (it is not on
  `evidence/index.js`). `reduceManifestForHashing` comes from `index.js`. `Role A Prompts/13`
  Task C suggests re-exporting `canonicalize` from the public surface.
- **`jszip.min.js` contains one dead `new Function` branch** (its bundled `setImmediate`
  polyfill's non-function fallback, never reached by JSZip's own calls). Not executed at load
  time; confirm nothing trips it when the extension is loaded unpacked under MV3 CSP — a check for
  the step-08 integration pass.
- **Signature format in README:** the signature is over the 32 **raw** digest bytes (not the hex
  ASCII) and is IEEE-P1363 r‖s (not DER) — the README spells both out beneath the verbatim recipe
  so a stock-tools verifier does not stall.

---

## Step 08 — Integration tests, copy audit, demo script, README (C8)

### Task 1 — integration tests

`tests/integration/pipeline.test.js` (2 tests, `fake-indexeddb`, no browser):

- **Full path** — `lockEvidence` → `vaultRepo.list()` (asserts no `screenshot_ciphertext` / `iv` /
  `manifest` on the projection) → `getDecryptedScreenshot` (asserts PNG magic bytes) →
  `verifyEvidence` **VERIFIED** → `__tamperDemo(id, "modify_metadata")` → `verifyEvidence`
  **MODIFIED** with `VERIFY_DETAILS.METADATA_MISMATCH` and `last_verification` persisted →
  `__tamperDemo(id, "restore")` → **VERIFIED** → `buildPdfReport` (`%PDF-`, >1 KB) and
  `buildPackageZip` (`PK`, six entries, `manifest.json` === `canonicalize(reduceManifestForHashing(manifest))`).
- **Independent verification from an empty vault** — build a package, then `clear()` the evidence
  + settings stores (keeping only `STORE_KEYS`, which the screenshot hash needs), assert
  `list()` is empty, then from the **zip bytes only**: `sha256Utf8(manifest.json)` reproduces
  `manifest_hash` (cross-checked against the pre-wipe vault value) and equals
  `sha256Canonical(reduceManifestForHashing(parsed))`; `sha256Canonical(ai_derived_metadata)` ===
  `integrity.metadata_hash`; `verifyManifestSignature(recomputed_hash, signature.sig,
  public-key.jwk)` === true and a one-char flip of the hash → false; `sha256Bytes(decrypt(
  screenshot.enc, iv-from-manifest, vault key))` === `integrity.screenshot_hash`.
  - **Design note surfaced here:** the package's `manifest.json` is the *reduced* manifest, so it
    carries **no `integrity.manifest_hash` and no `signature` block** — a hash cannot contain
    itself, and `signature.sig` pins it instead. The README worked example already computes the
    hash from the file rather than reading it, so this is correct and self-sufficient; the test
    asserts both keys are absent.

### Task 2 — copy audit (spec §36) — outcome

Ran the §36 grep (`admissib|proves|guarantee|locally|local only|everything is local|recover(s|ed)?
deleted|identif(y|ies) (the )?sender|stalker|threat level`) over `extension/src`, `demo`, `docs`,
`README.md`, and reviewed every rendered string in the popup, the vault, and the detail / verify /
review panels.

**Result: no user-facing string was rewritten — the honesty layer already holds.** Every hit is
one of:

| Where | Hit | Verdict |
|---|---|---|
| `extension/src/**/*.js` | `sign.js` "PROVES / does not", `tamper-demo.js` "guaranteed to change", `vision-provider.js` / `demo-provider.js` "guaranteed to return", the §36 reminder comments in `pdf-report.js` / `verify-readme.txt.js` / `empty-state.js`, `verify-panel.js` "locally-derived value" | **code comments**, not shipped text |
| `verify-readme.txt.js` `CANNOT_ESTABLISH` | "legal admissibility — whether a court will accept this evidence **is not** for any tool to determine." | negated, §27-correct |
| `README.md` | "It **does not** prove: … legally admissible", "Legal admissibility **is not guaranteed** / EVOCK **does not** guarantee…", "**not** a universal deleted-message recovery system", "EVOCK **cannot** independently establish: … guaranteed legal admissibility" | every hit inside an explicit *does not / cannot / is not guaranteed* sentence |
| `docs/EVOCK.md`, `docs/role-*-status.md` | spec text and internal status notes | not user-facing |

Popup / vault / panel strings: reviewed, all clean (`"Digital Evidence Preservation"`, `"AI
extraction unavailable — screenshot preserved without derived metadata"`, `"Stored in the local
vault, hashed, signed and encrypted"`, the verify-panel `HONEST_FOOTER`, the empty-state copy).
The step-07 `tests/export/copy-audit.test.js` already gates the PDF + README strings on every
build.

### Task 3 — `docs/demo-script.md`

Added. A timed (< 5 min) offline walkthrough: provider set to **Demo** (rehearsed fallback,
stated up front), open `demo/chat.html`, one-click Preserve → vault → detail → **Verify ✓** →
tamper from the **service-worker console** (`globalThis.__EVOCK_DEV__ = true; const { __tamperDemo }
= await import('./src/verify/tamper-demo.js'); await __tamperDemo('NK-0001', 'modify_metadata')`)
→ **Verify ❌** with the recorded-vs-current pair → restore → **Verify ✓** → export PDF + ZIP →
optional `unzip -p … README.txt`. Includes a closing line and a "if something goes wrong" list.

- The tamper step uses the console, not a UI button: `verify/tamper-demo.js` is deliberately never
  imported by production code, and `MSG.TAMPER_DEMO` is defined but unrouted. A dynamic `import()`
  behind the dev flag keeps that property. If a one-click dev button is wanted later it is a small
  Role A/B worker route (`TAMPER_DEMO`) plus a dev-gated control — tracked, not built.

### Task 4 — `README.md`

- "Running the Prototype §1" — kept "no build step"; added that `jsPDF` / `JSZip` ride in
  `extension/src/vendor/` so loading needs no install, and a `npm install && npm test && npm run
  lint` block for the test suite.
- Replaced the stale "vault browsing / export UI … is not built yet" paragraph with a
  "§4 Browse, verify and export" section (Open Vault, detail view, Verify, Edit metadata, Export).
- "Evidence Export" — the report field list is now the spec §19 order with the real filename; the
  package tree is the real six entries with a note that `README.txt` makes it reproducible.
- Bridge / OpenRouter-key text unchanged.

### Task 5 — Role C Definition-of-Done pass

| # | Check | Status |
|---|---|---|
| 1 | `npm i` → loadable unpacked extension, first try | **PASS (adapted)** — no bundler (step 00); `extension/` loads unpacked with vendored libs checked in, no `npm run build`. Verified served over http + in the browser pane across steps 03–07. |
| 2 | Fixtures committed and used by other roles' tests | **PASS** — `tests/fixtures/*` + `tests/helpers/{make-vault,ui-fixtures}.js`; Role B's `revise-metadata` / verifier tests consume `record.versioned.sample.json`. |
| 3 | Vault lists records grouped chronologically without loading a screenshot | **PASS** — `timeline.js` + `vault.js`; `assertNoCiphertext` guards the list; integration test asserts the projection has no bytes. |
| 4 | Detail view: screenshot, derived metadata (distinct + labelled), capture context, three hashes, signature, timestamp status, encryption status | **PASS** — `detail-panel.js` + `derived-metadata-block.js` + `integrity-block.js`. |
| 5 | Human review/edit → new signed version, original preserved, no silent overwrite | **PASS** — `review-editor.js`; Role B `reviseMetadata` (step 12) appends a version, Role C never signs. |
| 6 | Verification UI shows recorded-vs-current hashes side by side and names the changed field | **PASS** — `verify-panel.js` MODIFIED branch, `current_integrity` from Role B step 11. |
| 7 | PDF has every spec §19 field plus an accurate Limitations section | **PASS** — `pdf-report.js`, `PDF_SECTIONS` order test + Limitations content test. |
| 8 | ZIP has all six entries and verifies independently on a clean machine | **PASS** — `package-zip.js`; `tests/integration/pipeline.test.js` reproduces every hash + the signature from an empty vault. |
| 9 | Every user-facing string passes the §36 audit | **PASS** — Task 2 above; `tests/export/copy-audit.test.js` keeps the PDF/README strings gated. |
| 10 | `docs/demo-script.md` runs start to finish in under five minutes with the network off | **PASS (on paper)** — script written to the < 5 min budget with the Demo provider; a live run-through on the three machines is the group rehearsal item. |

### Follow-ups tracked (not blockers)

- **`Role A Prompts/13`** — ratify `GET_EVIDENCE { for_export }` (done by Role A step 13) / worker-side
  export decision (kept page-side).
- **`MSG.TAMPER_DEMO` route** — optional one-click dev tamper button; console path works today.
- **`jszip.min.js` dead `new Function` branch** — confirm untripped under MV3 CSP on a real unpacked
  load (load-time safe; JSZip never calls that path).
- **DoD #1 / #10 live run** — load-unpacked + full offline demo on all three machines at the group sync.
