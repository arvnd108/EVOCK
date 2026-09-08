# EVOCK

## Digital Evidence Preservation for Online Abuse

EVOCK is a digital evidence preservation tool designed for people experiencing online abuse such as cyberstalking, harassment, threats, blackmail, impersonation, and repeated unwanted contact.

It focuses on a specific problem: digital abuse may disappear, change, or become difficult to organize before the victim begins a formal reporting or investigation process.

EVOCK helps preserve the incident while it is still visible, structure the captured information, protect the resulting record cryptographically, and verify whether the preserved evidence has been modified later.

---

## The Problem

Digital abuse often occurs through dynamic online platforms where messages and other content can be:

- deleted or unsent;
- edited;
- hidden or made inaccessible;
- associated with multiple accounts or conversations;
- spread across different dates, URLs, profiles, and messages.

A conventional screenshot is useful because it preserves what was visible on the screen, but it does not inherently provide a structured evidence workflow or a cryptographic integrity record.

This creates an evidence-preservation gap between:

```text
Incident occurs
      ↓
Evidence is visible
      ↓
Content may disappear or change
      ↓
Victim reports later
      ↓
Evidence and context must be reconstructed
```

EVOCK addresses the preservation stage before that gap becomes larger.

---

## How EVOCK Works

EVOCK follows four core stages:

```text
CAPTURE → EXTRACT → LOCK → VERIFY
```

### 1. Capture

A Chromium browser extension lets the user explicitly choose **Preserve Evidence**.

EVOCK captures the currently visible browser state as a screenshot and records relevant capture context such as:

- current URL;
- domain;
- capture timestamp;
- screenshot dimensions.

The screenshot is preserved as the original visual artifact.

### 2. Extract

A vision-language model can analyze the screenshot and extract information that is visibly present, such as:

- platform;
- account or contact identifier;
- visible message text;
- visible timestamp;
- visible date;
- other relevant visual context.

The AI output is treated as **derived metadata**, not as a replacement for the screenshot.

```text
SCREENSHOT
= ORIGINAL VISUAL EVIDENCE

VISION AI OUTPUT
= DERIVED STRUCTURED METADATA
```

The extraction process is intentionally constrained to visible information so that the model does not need access to hidden platform data.

### 3. Lock

The original screenshot, AI-derived metadata, and capture context are combined into an evidence record.

EVOCK then applies cryptographic protection using:

- SHA-256 integrity hashing;
- ECDSA P-256 digital signatures;
- timestamp information;
- AES-GCM encryption.

This produces a protected evidence record whose integrity can be checked later.

### 4. Verify

EVOCK can later recompute the relevant cryptographic fingerprints and verify the digital signature.

```text
Recorded fingerprint
        vs
Recalculated fingerprint
```

Result:

```text
✓ INTEGRITY VERIFIED
```

or:

```text
❌ MODIFICATION DETECTED
```

---

## Running the Prototype

### 1. Load the extension

1. Open `chrome://extensions` and enable **Developer mode**.
2. **Load unpacked** and select the `extension/` directory.
3. Pin EVOCK and open it on any normal web page.

The extension runs directly from source — **no build step**. The two third-party
libraries the export feature uses (`jsPDF`, `JSZip`) are checked in as browser
builds under `extension/src/vendor/`, so nothing needs installing to load or run
the extension.

To run the test suite you do need the dev dependencies:

```bash
npm install
npm test          # vitest — unit + integration
npm run lint      # eslint, must be clean
python3 tests/run-tests.py                 # Role A extraction-schema harness
python3 tests/bridge-and-vision.test.py    # bridge + vision-provider harness
```

### 2. Start the local AI bridge (for Vision extraction)

The bridge is a tiny local proxy that holds your OpenRouter API key so it never
ships inside the extension. It is only needed for the **Vision** provider; the
**Demo** provider works fully offline.

```bash
cp bridge/.env.example bridge/.env
# edit bridge/.env and set OPENROUTER_API_KEY=...
cd bridge && npm start
```

Requirements: Node ≥ 18. There are no dependencies to install. The bridge binds
to `127.0.0.1:8787` only and refuses any non-loopback bind. Check it with
`curl http://127.0.0.1:8787/health`; the popup's Settings screen shows the same
status and the active model.

### 3. Preserve

Click **PRESERVE EVIDENCE**. One click runs the whole pipeline with no prompt in
between: capture → AI extraction → hash → encrypt → sign → device timestamp →
store. The popup shows each stage live and finishes on `EVIDENCE PRESERVED —
NK-0001`. The record is written to the browser's IndexedDB vault, encrypted with
AES-GCM and signed with a per-vault ECDSA P-256 key.

If AI extraction is unavailable, preservation still completes — the screenshot,
its hashes, signature and encryption are produced regardless (see **Fail
gracefully**). If the vault write itself fails, the popup keeps the screenshot on
screen and says so rather than losing it silently.

### 4. Browse, verify and export

Click **Open Vault** in the popup (or open `src/vault/vault.html` from the
extension). The vault lists preserved records grouped by day, metadata only — no
screenshot is loaded until you open a record.

Open a record for the decrypted screenshot, the AI-derived metadata block
(tinted and labelled — it is model output, not ground truth), the capture
context, and the three SHA-256 hashes with signature, trusted-timestamp and
encryption status.

- **Verify** recomputes every hash and checks the signature: `✓ INTEGRITY
  VERIFIED`, or `❌ MODIFICATION DETECTED` with the recorded-vs-current hash pair
  and the changed field named.
- **Edit metadata** records a human correction as a new signed version; the
  original AI-derived version is kept and stays independently verifiable.
- **Export ▾** produces a human-readable PDF (`EVOCK-NK-0001-report.pdf`) and a
  machine-readable ZIP (`EVOCK-NK-0001-package.zip`), both built on the page and
  saved through the browser's download manager. Nothing is uploaded.

---

## Evidence Model

EVOCK keeps a clear distinction between original evidence and information derived from it.

```text
                    EVIDENCE RECORD
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼                         ▼
     ORIGINAL ARTIFACT             DERIVED DATA
        Screenshot                  Vision AI
              │                         │
              ▼                         ▼
        Screenshot Hash             Metadata Hash
              │                         │
              └────────────┬────────────┘
                           ▼
                    Evidence Manifest
                           │
                           ▼
                    Digital Signature
                           │
                           ▼
                   Timestamp Information
                           │
                           ▼
                     Encrypted Storage
```

This design means the original screenshot remains available for inspection even if AI-generated metadata is incomplete or incorrect.

---

## Cryptographic Integrity

### SHA-256

EVOCK uses SHA-256 to create a cryptographic fingerprint of the protected evidence.

A later change to the protected artifact produces a different fingerprint.

SHA-256 is used for **integrity verification**. It does not prove:

- that the underlying conversation is truthful;
- that the sender is the person represented by an account;
- that an artifact is legally admissible.

### Digital Signatures

EVOCK uses ECDSA with P-256 for digital signatures.

The evidence record can be signed with a private signing key and later checked using the corresponding public key.

### Encryption

Sensitive evidence artifacts are encrypted using AES-GCM with a 256-bit key.

Encryption is intended to protect the confidentiality of preserved evidence during local storage.

### Timestamping

EVOCK records the device capture timestamp.

The architecture also supports a trusted timestamping layer. A local device timestamp is kept conceptually separate from a trusted timestamp authority record.

---

## Privacy

EVOCK is designed around victim-controlled evidence preservation.

The current architecture uses a vision service for screenshot analysis, so AI extraction may require the screenshot to be transmitted to the configured vision provider.

The intended flow is:

```text
Browser
   ↓
Local screenshot capture
   ↓
Vision analysis
   ↓
Structured metadata
   ↓
Encrypted local evidence storage
```

Preserving evidence is a single action. Clicking **Preserve Evidence** runs the whole pipeline with no prompt or confirmation step at any point, because the moment of capture is time-critical and content can disappear while a dialog is open.

If the vision service is unavailable, preservation continues without the derived metadata rather than failing.

The original evidence remains available as the source artifact.

A future on-device vision model can reduce or eliminate the need to transmit sensitive screenshots to a third-party inference service.

---

## Local Evidence Vault

Preserved evidence can be organized in a local vault.

An evidence record can contain:

- evidence ID;
- source information;
- original screenshot;
- AI-derived metadata;
- capture timestamp;
- integrity fingerprints;
- digital signature;
- timestamp status;
- encryption status;
- verification status.

Multiple records can be organized into a chronological incident timeline.

For example:

```text
12 Aug
E001 — Unwanted contact

13 Aug
E002 — Continued contact

14 Aug
E003 — Threatening message

15 Aug
E004 — New account continues contact
```

The timeline is intended to organize captured facts rather than make unsupported legal or psychological conclusions.

---

## Evidence Export

EVOCK can produce two forms of output.

### Human-readable report (`EVOCK-NK-0001-report.pdf`)

A `jsPDF` report, in this order: evidence ID; platform/source; contact/account;
visible content; visible timestamp; device capture time; screenshot preview; all
three SHA-256 hashes; signature status; trusted-timestamp status; the last
verification result; and a **Limitations** page drawn from *What EVOCK can and
cannot establish* that is never trimmed. AI-derived fields are marked as such.

### Machine-readable package (`EVOCK-NK-0001-package.zip`)

```text
NK-0001/
├── manifest.json        # EvidenceManifest, canonical + reduced — byte-identical
│                        #   to what the vault hashed for manifest_hash
├── screenshot.enc       # AES-GCM ciphertext (the decryption key is NOT included)
├── signature.sig        # base64 ECDSA P-256 signature
├── public-key.jwk       # so the signature checks without this vault
├── verification.json    # the last VerificationResult (or null)
└── README.txt           # the exact hashing order, reproducible with stock tools
```

`README.txt` spells out how to recompute each hash and check the signature with
nothing but Python and the package contents. The integration test does exactly
that from an empty vault.

---

## Target Users

### Primary users

People experiencing:

- cyberstalking;
- persistent online harassment;
- threats;
- blackmail or extortion;
- impersonation;
- repeated unwanted digital contact.

### Secondary users

#### Investigators

EVOCK can provide structured, chronological evidence records with integrity information.

#### Lawyers and legal advisors

EVOCK can make preserved material easier to review and organize before or during legal consultation.

EVOCK is not intended to replace professional forensic examination or legal procedure.

---

## Technology Stack

### Application

- JavaScript
- Vite
- Chromium Manifest V3

### Evidence Capture

- Chromium browser extension APIs
- `chrome.tabs.captureVisibleTab()`

### AI Extraction

- Vision-Language Model (VLM)
- OpenRouter API
- Structured JSON extraction

### Cryptography

- Web Crypto API
- SHA-256
- ECDSA P-256
- AES-GCM (256-bit)

### Storage

- IndexedDB

### Export

- jsPDF
- JSZip

### Timestamping

- Trusted Timestamping
- RFC 3161-compatible timestamping support

### Optional / Future

- TLSNotary-style web provenance
- OCR
- On-device vision models

---

## Architecture

At a high level:

```text
                         USER
                           │
                           ▼
                  Chromium Browser
                           │
                           ▼
                     EVOCK Extension
                           │
                  [ PRESERVE EVIDENCE ]
                           │
                           ▼
                      SCREENSHOT
                           │
                           ▼
                    VISION AI
                           │
                           ▼
                 STRUCTURED METADATA
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
       ORIGINAL SCREENSHOT         AI METADATA
              │                         │
              ▼                         ▼
          SHA-256 HASH              SHA-256 HASH
              │                         │
              └────────────┬────────────┘
                           ▼
                    EVIDENCE MANIFEST
                           │
                           ▼
                    DIGITAL SIGNATURE
                           │
                           ▼
                  TIMESTAMP INFORMATION
                           │
                           ▼
                    AES-GCM ENCRYPTION
                           │
                           ▼
                     LOCAL VAULT
                           │
                           ▼
                      VERIFICATION
                           │
                   ┌───────┴───────┐
                   ▼               ▼
             ✓ VERIFIED        ❌ MODIFIED
```

---

## Design Principles

### Preserve first

Evidence preservation should remain possible even when AI extraction fails.

### Keep the original

The screenshot is the original visual artifact and is never replaced by AI-generated text.

### Treat AI as derived information

AI interprets the screenshot; it does not become the source of truth.

### Protect integrity

Cryptographic fingerprints and signatures make later changes detectable.

### Protect confidentiality

Sensitive evidence should remain encrypted during local storage.

### Minimize claims

The system should clearly distinguish what it can verify from what requires external records or professional investigation.

### Fail gracefully

If an AI service is unavailable, screenshot preservation should still be possible.

---

## Limitations

EVOCK has important boundaries.

### AI extraction can be inaccurate

Vision models can misread names, timestamps, or small text.

**Mitigation:** preserve the original screenshot, constrain extraction prompts, allow user review, and label model output as derived metadata.

### Remote AI analysis creates a privacy trade-off

A remote vision provider may receive the screenshot during extraction.

**Mitigation:** minimize transmissions, encrypt local storage, and support future on-device inference.

### Platform backend data is not accessed

EVOCK does not independently obtain:

- hidden platform databases;
- private server logs;
- sender IP addresses;
- deleted server-side messages that were never captured.

### Deleted content cannot be recovered if it was never captured

EVOCK is a preservation tool, not a universal deleted-message recovery system.

### Legal admissibility is not guaranteed

EVOCK does not guarantee that a particular evidence package will be accepted by a court or other authority. Legal treatment depends on the applicable jurisdiction, procedure, and case.

### Account ownership is not automatically established

A visible username or account identifier does not by itself prove the real-world identity of the person operating that account.

### Local storage can create device-loss risk

A device-only evidence vault can be lost if the device is lost or compromised.

**Future mitigation:** optional encrypted backup or recovery mechanisms.

### Trusted timestamping can require external infrastructure

A device clock is not equivalent to an independently trusted timestamp authority.

**Future mitigation:** integrate a real trusted timestamp provider while keeping local capture time separate.

---

## Future Direction

Potential future improvements include:

- on-device or hybrid vision AI;
- encrypted backup;
- stronger web provenance mechanisms;
- human review and approval of AI-derived metadata;
- multi-platform evidence correlation;
- additional capture sources;
- investigator-focused workflows;
- expanded mobile support.

---

## What EVOCK Can Establish

Within its own architecture, EVOCK can establish:

- a visual artifact was captured;
- what metadata was derived from that artifact;
- when the device recorded the capture;
- whether the protected evidence changed after preservation;
- whether a digital signature verifies;
- how captured incidents are related chronologically;
- that an encrypted evidence package exists.

## What EVOCK Cannot Establish by Itself

EVOCK cannot independently establish:

- the truthfulness of the underlying conversation;
- the real-world identity of an account owner;
- hidden platform/server records;
- sender IP information;
- deleted server-side content that was never captured;
- guaranteed legal admissibility.

---

## Project Goal

EVOCK aims to move digital-abuse evidence handling from:

```text
Screenshot
   ↓
Scattered files
   ↓
Manual reconstruction
```

toward:

```text
Capture
   ↓
Structure
   ↓
Cryptographic Lock
   ↓
Protected Storage
   ↓
Verification
```

### Final description

> **EVOCK turns a fragile screenshot into a structured, cryptographically protected, and verifiable digital incident record.**
