# EVOCK — offline demo script

> **Target: under 5 minutes, network cable out.** Every step below works with no
> internet. The AI provider is switched to **Demo** so a dead network can never
> break the presentation — this is the rehearsed fallback, state it out loud at
> the start.

## Before the room (2 min, once)

1. `chrome://extensions` → Developer mode on → **Load unpacked** → select
   `extension/`.
2. Open the popup → **Settings** → Extraction Provider → **Demo Provider
   (offline deterministic)**. Close Settings.
   - The Demo provider returns a fixed, structured result with no bridge and no
     network. The Vision provider and the `bridge/` proxy are **not needed** for
     this demo — don't start the bridge.
3. Open `demo/chat.html` in a normal tab (File → Open, or drag it in). This is a
   fictional, offline sample conversation — no images, no web fonts, no network.
4. Have the service-worker console ready for step 7: `chrome://extensions` →
   EVOCK → **Inspect views: service worker**.

## The demo (target 3–4 min)

| # | Do | Say / expect |
|---|---|---|
| 1 | On `demo/chat.html`, open the EVOCK popup. | "This is the abuse we want to preserve before it disappears." |
| 2 | Click **PRESERVE EVIDENCE**. | One click, no prompts. The stage list runs capture → extract → hash → encrypt → sign → timestamp → store and finishes on **`Evidence Preserved — NK-0001`**. |
| 3 | Click **Open Vault**. | The vault page opens. One record, under today's date group. Metadata only — no screenshot was loaded to draw this list. |
| 4 | Click the record. | Detail view: the decrypted screenshot, the **AI-derived metadata** block (tinted + labelled — "a vision model can misread names, times, small text"), capture context with a **Device time** row (not a trusted timestamp), and the integrity block: three SHA-256 hashes, `✓ ECDSA P-256`, Trusted timestamp **Not configured**, `✓ AES-GCM 256`. |
| 5 | Click **Verify**. | Green **`✓ INTEGRITY VERIFIED`** — four checks tick, "Verified &lt;time&gt;". |
| 6 | In the service-worker console, paste (the path is extension-root-absolute): <br>`globalThis.__EVOCK_DEV__ = true;` <br>`const { __tamperDemo } = await import(chrome.runtime.getURL('src/verify/tamper-demo.js'));` <br>`await __tamperDemo('NK-0001', 'modify_metadata');` | "Now someone edits the vault file directly — changing the message text without recomputing the hash." The harness is dev-only; it refuses to run in a production build. |
| 7 | Back on the detail view, click the record again to reload it, then **Verify**. | Red **`❌ MODIFICATION DETECTED`**. The **recorded vs current** hash pair is shown side by side, and the line names the changed field ("The AI-derived metadata does not match the record created on 1 Sep 2026"). `metadata hash mismatch` is listed verbatim. |
| 8 | In the console, paste: <br>`await __tamperDemo('NK-0001', 'restore');` <br>then reload the record and **Verify**. | Back to green **`✓ INTEGRITY VERIFIED`** — the restore is byte-exact. |
| 9 | Click **Export ▾** → **Human-readable report (PDF)**, then **Evidence package (ZIP)**. | Two files land in Downloads: `EVOCK-NK-0001-report.pdf` and `EVOCK-NK-0001-package.zip`. Open the PDF — every §19 field, AI-derived fields marked, and a Limitations page that says plainly what EVOCK cannot establish. Open the ZIP — `manifest.json`, `screenshot.enc`, `signature.sig`, `public-key.jwk`, `verification.json`, `README.txt`. |
| 10 | (Optional, 20 s) `unzip -p EVOCK-NK-0001-package.zip NK-0001/README.txt \| head -40` | "An investigator with Python and no EVOCK install can recompute every hash and check the signature from this file alone." |

## Closing line

"EVOCK preserves the artifact, shows whether the stored record has changed since
preservation, and puts the whole chain in a package someone else can check. It
does not decide whether the conversation is true or who is behind the account —
and the report says so."

## If something goes wrong

- **Popup shows a capture error** — make sure the active tab is a normal page
  (`demo/chat.html`), not `chrome://` or the extensions page.
- **Vault says "Could not load the vault"** — the service worker was asleep;
  reopen the vault tab.
- **`__tamperDemo` throws "disabled in production builds"** — run the
  `globalThis.__EVOCK_DEV__ = true;` line first, in the **service worker**
  console (not the page console).
- **Network anxiety** — confirm the provider is **Demo** in Settings. Nothing in
  this script calls out.
