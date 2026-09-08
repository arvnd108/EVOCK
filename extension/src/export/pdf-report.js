/**
 * EVOCK — human-readable PDF report (Role C, step 07 / C6, spec §19).
 *
 * Builds a jsPDF document with every field spec §19 lists, IN THAT ORDER.
 *
 * This module computes nothing cryptographic. It reads a StoredEvidenceRecord's
 * manifest, the last VerificationResult, and a decrypted screenshot data URL,
 * and lays them out. The AI-derived fields are visually marked as AI-derived,
 * the same honesty rule the detail view follows.
 *
 * LIBRARY SEAM: `jsPDF` is injected. Vitest passes the npm package; the vault
 * page passes `globalThis.jspdf.jsPDF` from the vendored classic script. The
 * module never imports jspdf directly, so it stays loadable without a bundler.
 *
 * COPY DISCIPLINE (spec §36 — audited in step 08): no "court-admissible", no
 * "proves", no "everything is local", no "recovers deleted messages". Every
 * limitation is phrased as something EVOCK cannot do.
 */

import { formatDay, formatDeviceTime } from "../vault/components/record-card.js";
import { directionLabel } from "../shared/message-direction.js";

/** spec §19 section titles, in the required order. A test asserts this order. */
export const PDF_SECTIONS = Object.freeze([
  "Evidence ID",
  "Platform / source",
  "Contact / account",
  "Visible content",
  "Visible timestamp",
  "Device capture time",
  "Screenshot",
  "SHA-256 hashes",
  "Signature",
  "Trusted timestamp",
  "Verification result"
]);

export const AI_DERIVED_NOTE =
  "The four fields below were extracted from the screenshot by a vision model " +
  "(AI-derived). A model can misread names, timestamps and small text. Read them " +
  "against the screenshot, not in place of it.";

/**
 * @param {string} evidence_id
 * @returns {string} e.g. "EVOCK-NK-0003-report.pdf"
 */
export function pdfReportFilename(evidence_id) {
  return `EVOCK-${evidence_id || "NK-XXXX"}-report.pdf`;
}

/**
 * Build the PDF.
 *
 * @param {{
 *   record: import("../shared/types.js").StoredEvidenceRecord,
 *   verification?: import("../shared/types.js").VerificationResult | null,
 *   screenshotDataUrl?: string | null
 * }} input
 * @param {{ jsPDF?: Function }} [opts]
 * @returns {{ bytes: Uint8Array, text: string, pages: number }}
 *   `bytes` is the PDF file; `text` is every line drawn, joined by "\n", so a
 *   test can scan section order and copy without a PDF parser.
 */
export function buildPdfReport(
  { record, verification = null, screenshotDataUrl = null },
  opts = {}
) {
  const JsPDF = resolveJsPDF(opts.jsPDF);
  if (typeof JsPDF !== "function") {
    throw new Error(
      "buildPdfReport: no jsPDF constructor available (inject { jsPDF } or load the vendored script)"
    );
  }
  if (!record || typeof record !== "object" || !record.manifest) {
    throw new TypeError("buildPdfReport: a StoredEvidenceRecord with a manifest is required");
  }

  const manifest = record.manifest;
  const evidenceId = record.evidence_id || manifest.evidence_id || "NK-XXXX";
  const source = manifest.source || {};
  const capture = manifest.capture || {};
  const aiBlock = manifest.ai_derived_metadata || {};
  const aiOk = aiBlock.status === "ok" && aiBlock.data && typeof aiBlock.data === "object";
  const data = aiOk ? aiBlock.data : null;
  const integrity = manifest.integrity || {};
  const signature = manifest.signature || {};
  const timestamp = manifest.timestamp || {};

  const doc = new JsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 56;
  const contentW = pageW - margin * 2;

  /** @type {string[]} every line we draw, for the test-facing `text`. */
  const drawn = [];
  let y = margin;

  const ensure = (needed) => {
    if (y + needed > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };
  const write = (
    text,
    { size = 10, style = "normal", font = "helvetica", gap = 4, indent = 0 } = {}
  ) => {
    doc.setFont(font, style);
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(String(text), contentW - indent);
    for (const ln of lines) {
      ensure(size + gap);
      doc.text(ln, margin + indent, y);
      y += size + gap;
    }
    // Record the LOGICAL string (pre-wrap), so content/order/copy checks read
    // sentences, not layout fragments.
    drawn.push(String(text));
  };
  const heading = (text) => {
    y += 10;
    ensure(24);
    write(text, { size: 12, style: "bold", gap: 6 });
  };
  const spacer = (h = 6) => {
    y += h;
  };

  // --- Title ---------------------------------------------------------------
  write("EVOCK — evidence report", { size: 18, style: "bold", gap: 8 });
  write("Tamper-evident evidence package · designed to support reporting and investigation", {
    size: 9,
    style: "normal",
    gap: 4
  });
  write(`Generated ${formatDeviceTime(new Date().toISOString())}`, { size: 9, gap: 4 });
  spacer(6);

  // 1. Evidence ID -------------------------------------------------------------
  heading("Evidence ID");
  write(evidenceId, { font: "courier", size: 11 });

  // AI-derived group note before sections 2–5.
  spacer(4);
  write(AI_DERIVED_NOTE, { size: 9, style: "italic" });

  // 2. Platform / source ----------------------------------------------------
  heading("Platform / source");
  if (aiOk) {
    write(`[AI-derived] Platform: ${data.platform ?? "not identified"}`);
  } else {
    write("[AI-derived] AI extraction unavailable — no derived metadata for this record.");
  }
  write(`Captured from: ${source.url || source.domain || "unknown"}`, { size: 9 });
  if (source.tab_title) write(`Tab title: ${source.tab_title}`, { size: 9 });

  // 3. Contact / account --------------------------------------------------
  heading("Contact / account");
  write(
    aiOk
      ? `[AI-derived] ${data.contact_name ?? "not identified"}`
      : "[AI-derived] AI extraction unavailable — no derived metadata for this record."
  );

  // 4. Visible content ----------------------------------------------------
  heading("Visible content");
  if (aiOk) {
    const messages = Array.isArray(data.messages) ? data.messages : [];
    if (messages.length === 0) {
      write("[AI-derived] No message text extracted.");
    } else {
      for (const m of messages) {
        const who = m?.sender || "message";
        const ts = typeof m?.visible_timestamp === "string" ? m.visible_timestamp.trim() : "";
        const stamp = ts ? ` [${ts}]` : "";
        write(`[AI-derived] ${directionLabel(m)} — ${who}${stamp}: ${m?.text ?? ""}`, {
          indent: 8
        });
      }
    }
  } else {
    write("[AI-derived] AI extraction unavailable — no derived metadata for this record.");
  }

  // 5. Visible timestamp ------------------------------------------------
  heading("Visible timestamp");
  if (aiOk) {
    const vt = [data.date, data.visible_time].filter(Boolean).join(" · ");
    write(`[AI-derived] ${vt || "not identified"}`);
  } else {
    write("[AI-derived] AI extraction unavailable — no derived metadata for this record.");
  }

  // 6. Device capture time --------------------------------------------
  // Labelled "device capture time", never "timestamp" (spec §25.11 honesty rule).
  heading("Device capture time");
  write(formatDeviceTime(capture.device_captured_at || record.created_at));
  write("This is the time the capturing device reported. It is not a trusted timestamp.", {
    size: 9,
    style: "italic"
  });

  // 7. Screenshot preview ----------------------------------------------
  heading("Screenshot");
  if (screenshotDataUrl) {
    const { w, h } = fitImage(doc, screenshotDataUrl, capture, contentW, pageH - margin * 2 - 40);
    ensure(h + 8);
    try {
      doc.addImage(screenshotDataUrl, "PNG", margin, y, w, h);
      y += h + 8;
      drawn.push("[screenshot embedded]");
    } catch {
      write("[screenshot could not be embedded in this report]");
    }
  } else {
    write("[screenshot not available in this export]");
  }
  write("Preserved screenshot, decrypted for this report.", { size: 9, style: "italic" });

  // 8. SHA-256 hashes ------------------------------------------------
  heading("SHA-256 hashes");
  write(`hash algorithm: ${integrity.hash_algorithm || "SHA-256"}`, { size: 9 });
  hashLine("screenshot", integrity.screenshot_hash);
  hashLine("metadata", integrity.metadata_hash);
  hashLine("manifest", integrity.manifest_hash);

  // 9. Signature status --------------------------------------------
  heading("Signature");
  write(signatureStatusLine(signature, verification));

  // 10. Trusted-timestamp status ---------------------------------
  heading("Trusted timestamp");
  write(trustedTimestampLine(timestamp));

  // 11. Verification result -------------------------------------
  heading("Verification result");
  if (verification && typeof verification === "object") {
    write(`Status: ${verification.status || "unknown"}`, { style: "bold" });
    if (verification.verified_at) {
      write(`Checked: ${formatDeviceTime(verification.verified_at)}`, { size: 9 });
    }
    write(
      `screenshot ${tick(verification.screenshot_hash_ok)}   ` +
        `metadata ${tick(verification.metadata_hash_ok)}   ` +
        `manifest ${tick(verification.manifest_hash_ok)}   ` +
        `signature ${tick(verification.signature_ok)}`,
      { font: "courier", size: 9 }
    );
    for (const d of Array.isArray(verification.details) ? verification.details : []) {
      write(`• ${d}`, { size: 9, indent: 8 }); // frozen VERIFY_DETAILS string, verbatim
    }
  } else {
    write("This record has not been re-verified since it was preserved.");
  }
  write(
    "Verification shows whether the stored record changed since preservation. It does not " +
      "establish who sent a message or whether the conversation is truthful.",
    { size: 9, style: "italic" }
  );

  const bytes = new Uint8Array(doc.output("arraybuffer"));
  return { bytes, text: drawn.join("\n"), pages: doc.getNumberOfPages() };

  // --- local helpers ---------------------------------------------------
  function hashLine(label, hex) {
    write(`${label.padEnd(11)} ${hex || "— (absent)"}`, { font: "courier", size: 8, gap: 3 });
  }
}

function tick(ok) {
  return ok === true ? "OK" : ok === false ? "FAIL" : "n/a";
}

function signatureStatusLine(signature, verification) {
  const algo =
    signature.algorithm === "ECDSA-P256-SHA256" ? "ECDSA P-256" : signature.algorithm || "none";
  const hasSig = typeof signature.signature === "string" && signature.signature.length > 0;
  if (verification && typeof verification.signature_ok === "boolean") {
    return verification.signature_ok
      ? `✓ ${algo} — signature verified` +
          (verification.verified_at ? ` (${formatDay(verification.verified_at)})` : "")
      : `✗ ${algo} — signature did NOT verify`;
  }
  if (!hasSig) return "No signature is attached to this record.";
  return `${algo} signature attached — not re-checked in this report.`;
}

function trustedTimestampLine(timestamp) {
  const status = timestamp.trusted_timestamp_status || "not_configured";
  const map = {
    not_configured: "Not configured.",
    pending: "Pending.",
    ok: "Recorded.",
    failed: "Failed."
  };
  const tail =
    status === "not_configured"
      ? " No third-party timestamp authority was used for this record."
      : "";
  return `${map[status] || status}${tail}`;
}

/**
 * Fit an image into (maxW × maxH), preserving aspect ratio. Ratio comes from
 * jsPDF's own image probe, then the manifest's recorded dimensions, then 4:3.
 */
function fitImage(doc, dataUrl, capture, maxW, maxH) {
  let ratio = 0;
  try {
    const props = doc.getImageProperties(dataUrl);
    if (props && props.width && props.height) ratio = props.width / props.height;
  } catch {
    /* fall through to manifest dimensions */
  }
  if (!ratio && capture.screenshot_width && capture.screenshot_height) {
    ratio = capture.screenshot_width / capture.screenshot_height;
  }
  if (!ratio || !Number.isFinite(ratio)) ratio = 4 / 3;

  let w = maxW;
  let h = w / ratio;
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }
  return { w, h };
}

/**
 * Resolve the jsPDF constructor from the injected option or the vendored global.
 * @param {Function} [injected]
 * @returns {Function|undefined}
 */
function resolveJsPDF(injected) {
  if (typeof injected === "function") return injected;
  const g = typeof globalThis !== "undefined" ? globalThis : {};
  if (g.jspdf && typeof g.jspdf.jsPDF === "function") return g.jspdf.jsPDF;
  if (typeof g.jsPDF === "function") return g.jsPDF;
  return undefined;
}
