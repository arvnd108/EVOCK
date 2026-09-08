# Role C — Presentation, Export & Platform: status

**Step 00 — Build pipeline, lint, project scripts (C1):** complete.
**Step 01 — Fixture set (C2):** complete.
**Step 02 — Static demo chat page (C7):** complete.
**Step 03 — Vault shell and chronological timeline (C3, part 1):** complete.
**Step 04 — Evidence detail view (C3, part 2):** complete.
**Tests:** `npm test` → 371 passing (+13 detail). `python3 tests/run-tests.py` → 20/20.
`python3 tests/bridge-and-vision.test.py` → 10/10. `npm run lint` → 0 errors, 0 warnings.

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

Steps 05–08: verification UI, human review/edit, export, integration tests +
copy audit.
