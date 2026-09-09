/**
 * EVOCK — MV3 service worker: the preservation orchestrator (Role A, A7).
 *
 * One click on PRESERVE EVIDENCE runs the whole pipeline with no prompt of any
 * kind in between (Rule 3). This file owns the sequencing; every step it calls
 * is somebody else's published function:
 *
 *   capture      → captureVisibleTab()          (Role A, capture/capture.js)
 *   extract      → provider.extract(capture)     (Role A, extraction/*)
 *   hash…store    → lockEvidence({...})          (Role B, evidence/index.js)
 *
 * Invariants enforced here:
 *  - Extraction failure never throws out of the pipeline. It is caught, turned
 *    into a contract-valid ExtractionResult with status:"failed", and the run
 *    continues (Rule 2 / Role A.md A7).
 *  - The vault is written exactly once, at the end, by lockEvidence. No partial
 *    records.
 *  - If anything after capture fails, a minimal screenshot-only preservation is
 *    attempted before the error is surfaced. Losing a capture is the worst
 *    outcome this product has.
 *  - In-flight state is mirrored to chrome.storage.session so a terminated
 *    worker can finish a stranded lock instead of dropping the screenshot.
 */

import { captureVisibleTab } from "../capture/capture.js";
import {
  getProvider,
  getSelectedProviderId,
  toFailedResult
} from "../extraction/provider.js";
import { MSG } from "../shared/messages.js";
import {
  lockEvidence,
  normalizeVersions,
  reviseMetadata,
  verifyEvidence
} from "../evidence/index.js";
import * as vaultRepo from "../storage/vault-repo.js";
import { bytesToBase64 } from "../crypto/hash.js";

console.log("EVOCK service worker loaded");

/** Key under which a run's in-flight state is mirrored for crash recovery. */
const SESSION_INFLIGHT_KEY = "evock:inflight";

// ---------------------------------------------------------------------------
// Progress reporting
// ---------------------------------------------------------------------------

/**
 * Push one PRESERVE_PROGRESS event to the popup. Best-effort: the popup may be
 * closed, in which case sendMessage rejects and we ignore it.
 *
 * @param {string} stage - one of PRESERVE_STAGES
 * @param {boolean} [ok] - true = done, false = failed/degraded, omitted = active
 * @param {string} [error]
 */
function sendProgress(stage, ok, error) {
  try {
    const p = chrome.runtime.sendMessage({
      type: MSG.PRESERVE_PROGRESS,
      payload: { stage, ok, error: error || null }
    });
    if (p && typeof p.then === "function") p.then(undefined, () => {});
  } catch {
    /* no receiver; progress is cosmetic */
  }
}

/**
 * lockEvidence announces each stage once, at its start (hash → encrypt → sign →
 * timestamp → store). Translate that into the popup's active/done model: when a
 * new stage starts, the previous one is done.
 *
 * @returns {{ emit: (stage: string) => void, finish: () => void }}
 */
function makeLockProgressBridge() {
  let prev = null;
  return {
    emit(stage) {
      if (prev) sendProgress(prev, true);
      prev = stage;
      sendProgress(stage);
    },
    finish() {
      if (prev) sendProgress(prev, true);
      prev = null;
    }
  };
}

// ---------------------------------------------------------------------------
// Session mirror (MV3 worker-termination guard)
// ---------------------------------------------------------------------------

async function setInflight(state) {
  try {
    await chrome.storage.session.set({ [SESSION_INFLIGHT_KEY]: state });
  } catch {
    /* session storage unavailable — recovery is a nice-to-have, not required */
  }
}

async function clearInflight() {
  try {
    await chrome.storage.session.remove(SESSION_INFLIGHT_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * On worker startup, finish any run that was terminated between capture and the
 * vault write. Without this, a killed worker loses a screenshot the user already
 * clicked to preserve.
 */
async function resumeStrandedRun() {
  let state;
  try {
    const bag = await chrome.storage.session.get(SESSION_INFLIGHT_KEY);
    state = bag[SESSION_INFLIGHT_KEY];
  } catch {
    return;
  }
  if (!state || !state.capture) return;

  console.warn("EVOCK: resuming a stranded preservation from session state");
  const extraction =
    state.extraction && typeof state.extraction === "object"
      ? state.extraction
      : toFailedResult(
          new Error("Worker restarted before extraction finished."),
          "vision"
        );

  try {
    await lockEvidence({ capture: state.capture, extraction });
    console.warn("EVOCK: stranded preservation completed and stored");
  } catch (err) {
    console.error("EVOCK: could not complete the stranded preservation:", err);
  } finally {
    await clearInflight();
  }
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * Run the configured provider. Never throws — a failure comes back as a
 * contract-valid ExtractionResult with status:"failed".
 *
 * @param {import("../shared/types.js").CaptureResult} capture
 * @returns {Promise<import("../shared/types.js").ExtractionResult>}
 */
async function runExtraction(capture) {
  let providerId = "vision";
  try {
    providerId = await getSelectedProviderId();
    const provider = getProvider(providerId);
    console.log(`EVOCK: extracting with provider "${provider.id}"`);
    const result = await provider.extract(capture);
    // A well-behaved provider already returns the §5.2 shape; trust it but make
    // sure a thrown-string or undefined never reaches lockEvidence.
    if (!result || typeof result !== "object") {
      return toFailedResult(new Error("Provider returned no result."), providerId);
    }
    return result;
  } catch (err) {
    console.warn("EVOCK: extraction threw — degrading to status:failed", err);
    return toFailedResult(err, providerId);
  }
}

/**
 * hash → encrypt → sign → timestamp → store, with a screenshot-only retry.
 *
 * If the first lock fails while extraction succeeded, the extraction payload
 * itself is the most likely culprit (odd unicode, size, a shape the manifest
 * builder rejects). Retry once with a failed-extraction stand-in so the
 * screenshot is still preserved. Only if THAT fails do we give up the write.
 *
 * @returns {Promise<{ record: import("../shared/types.js").StoredEvidenceRecord, extraction: import("../shared/types.js").ExtractionResult, degraded: boolean }>}
 */
async function lockWithFallback(capture, extraction) {
  const bridge = makeLockProgressBridge();
  try {
    const record = await lockEvidence({ capture, extraction, emit: bridge.emit });
    bridge.finish();
    return { record, extraction, degraded: false };
  } catch (firstErr) {
    console.error("EVOCK: lockEvidence failed:", firstErr);

    if (extraction.status !== "ok") {
      // Extraction was already failed — the fault is downstream (crypto,
      // IndexedDB). A retry with the same inputs will not help.
      throw attachCapture(firstErr, capture, extraction);
    }

    console.warn("EVOCK: retrying as screenshot-only preservation");
    const stripped = toFailedResult(
      new Error("Extraction dropped so the screenshot could still be preserved."),
      extraction.provider === "demo" ? "demo" : "vision"
    );
    const bridge2 = makeLockProgressBridge();
    try {
      const record = await lockEvidence({
        capture,
        extraction: stripped,
        emit: bridge2.emit
      });
      bridge2.finish();
      return { record, extraction: stripped, degraded: true };
    } catch (secondErr) {
      console.error("EVOCK: screenshot-only preservation also failed:", secondErr);
      throw attachCapture(secondErr, capture, stripped);
    }
  }
}

/** Carry the capture/extraction on an error so the popup can still show the shot. */
function attachCapture(err, capture, extraction) {
  const wrapped = err instanceof Error ? err : new Error(String(err));
  wrapped.capture = capture;
  wrapped.extraction = extraction;
  return wrapped;
}

/**
 * The whole preservation. Returns the response the popup renders.
 *
 * @returns {Promise<{ ok: boolean, evidence_id?: string, capture?: object, extraction?: object, degraded?: boolean, error?: string }>}
 */
export async function preserve() {
  // 1. Capture — the one step whose failure means there is nothing to preserve.
  sendProgress("capture");
  let capture;
  try {
    capture = await captureVisibleTab();
  } catch (err) {
    sendProgress("capture", false, err?.message || "Capture failed.");
    return { ok: false, error: err?.message || "Failed to capture the screenshot." };
  }
  sendProgress("capture", true);
  console.log("EVOCK: captured", {
    width: capture.width,
    height: capture.height,
    domain: capture.domain,
    bytes: capture.screenshotDataUrl?.length
  });
  await setInflight({ phase: "extract", capture });

  // 2. Extract — never fatal.
  sendProgress("extract");
  const extraction = await runExtraction(capture);
  sendProgress(
    "extract",
    extraction.status === "ok",
    extraction.status === "ok" ? null : extraction.error
  );
  await setInflight({ phase: "lock", capture, extraction });

  // 3. hash → encrypt → sign → timestamp → store (Role B), with fallback.
  try {
    const { record, extraction: finalExtraction, degraded } = await lockWithFallback(
      capture,
      extraction
    );
    await clearInflight();
    return {
      ok: true,
      evidence_id: record.evidence_id,
      capture,
      extraction: finalExtraction,
      degraded
    };
  } catch (err) {
    await clearInflight();
    return {
      ok: false,
      error:
        err?.message ||
        "The screenshot was captured but could not be written to the vault.",
      capture: err?.capture || capture,
      extraction: err?.extraction || extraction,
      degraded: true
    };
  }
}

// ---------------------------------------------------------------------------
// Message routing
// ---------------------------------------------------------------------------

/**
 * @param {any} message
 * @param {chrome.runtime.MessageSender} _sender
 * @param {(response: any) => void} sendResponse
 * @returns {boolean} true when the response is sent asynchronously
 */
export function handleMessage(message, _sender, sendResponse) {
  if (!message || typeof message !== "object") return false;

  switch (message.type) {
    case MSG.PRESERVE_START:
      preserve()
        .then(sendResponse)
        .catch((err) => {
          // preserve() is written not to throw; this is the last safety net.
          console.error("EVOCK: preserve() rejected unexpectedly:", err);
          sendResponse({ ok: false, error: err?.message || "Preservation failed." });
        });
      return true;

    case MSG.LIST_EVIDENCE:
      vaultRepo.list(message.payload || {}).then(
        (items) => sendResponse({ ok: true, items }),
        (err) => sendResponse({ ok: false, error: err?.message || "Could not list evidence." })
      );
      return true;

    case MSG.GET_EVIDENCE:
      (async () => {
        const id = message.payload?.evidence_id;
        const record = await vaultRepo.get(id);
        if (!record) return sendResponse({ ok: false, error: "Record not found." });
        const blob = await vaultRepo.getDecryptedScreenshot(id);
        // A data URL, not URL.createObjectURL — the latter is unavailable in an
        // MV3 service worker. Role C can drop this straight into an <img src>.
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const response = {
          ok: true,
          manifest: record.manifest,
          created_at: record.created_at,
          platform_label: record.platform_label,
          last_verification: record.last_verification,
          // Role C reads res.versions; a pre-1.1 record has none, so hand back the
          // implicit single "ai" version rather than an absent key.
          versions: normalizeVersions(record),
          screenshotDataUrl: `data:${blob.type || "image/png"};base64,${bytesToBase64(bytes)}`
        };
        // Export needs the raw AES-GCM ciphertext + IV so the ZIP package can
        // ship an inspectable integrity chain (Role C step 07 / C6). Only sent
        // when the vault page asks for it — the plaintext key is never included.
        if (message.payload?.for_export === true) {
          response.screenshot_ciphertext = bytesToBase64(new Uint8Array(record.screenshot_ciphertext));
          response.iv = bytesToBase64(new Uint8Array(record.iv));
        }
        sendResponse(response);
      })().catch((err) =>
        sendResponse({ ok: false, error: err?.message || "Could not load the record." })
      );
      return true;

    case MSG.VERIFY_EVIDENCE:
      // `version` (1-based) verifies an earlier version instead of the latest
      // (spec §26.4) — Role C's detail panel sends the version currently
      // selected in its history list, so the recorded/current hash pair the
      // panel shows are always for the same version. Omitted = latest.
      verifyEvidence(message.payload?.evidence_id, { version: message.payload?.version }).then(
        (result) => sendResponse({ ok: true, result }),
        (err) => sendResponse({ ok: false, error: err?.message || "Verification failed." })
      );
      return true;

    case MSG.REVISE_METADATA:
      // Role C's review editor sends the corrected ai_derived_metadata.data.
      // Role B re-canonicalizes / re-hashes / re-signs and appends a version —
      // the worker only routes; it never touches the manifest itself.
      reviseMetadata(message.payload?.evidence_id, message.payload?.data, {
        note: message.payload?.note ?? null
      }).then(
        (record) => sendResponse({ ok: true, record }),
        (err) =>
          sendResponse({ ok: false, error: err?.message || "Could not save the correction." })
      );
      return true;

    case MSG.DELETE_EVIDENCE:
      // Vault "Delete" on one row. Explicit user action; the vault page has
      // already confirmed with the user.
      vaultRepo.remove(message.payload?.evidence_id).then(
        () => sendResponse({ ok: true }),
        (err) => sendResponse({ ok: false, error: err?.message || "Could not delete the record." })
      );
      return true;

    case MSG.CLEAR_VAULT:
      // Vault "Clear" — delete every record in one transaction.
      vaultRepo.clear().then(
        () => sendResponse({ ok: true }),
        (err) => sendResponse({ ok: false, error: err?.message || "Could not clear the vault." })
      );
      return true;

    case MSG.GET_PASSPHRASE_EXPORT_STATUS:
      // Read-only — lets the export panel show "2 of 3 used" before the user
      // commits to anything. Never consumes an attempt.
      vaultRepo.getPassphraseExportStatus(message.payload?.evidence_id).then(
        ({ count, remaining, limit }) => sendResponse({ ok: true, count, remaining, limit }),
        (err) =>
          sendResponse({ ok: false, error: err?.message || "Could not read the export status." })
      );
      return true;

    case MSG.RECORD_PASSPHRASE_EXPORT:
      // Called by the export panel ONLY after chrome.downloads has the file —
      // this counts downloads, not attempts. vaultRepo enforces the limit
      // atomically, so a raced call from a second tab cannot slip past it.
      vaultRepo.recordPassphraseExport(message.payload?.evidence_id).then(
        ({ count, remaining, limit }) => sendResponse({ ok: true, count, remaining, limit }),
        (err) => {
          if (err?.name === "PassphraseExportLimitError") {
            sendResponse({ ok: false, error: err.message, limitReached: true, limit: err.limit });
          } else {
            sendResponse({ ok: false, error: err?.message || "Could not record the export." });
          }
        }
      );
      return true;

    default:
      return false;
  }
}

// Register only in a real extension context. Under Vitest (node) there is no
// chrome.* — importing this file for a unit test must not throw.
if (globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(handleMessage);
  resumeStrandedRun();
}
