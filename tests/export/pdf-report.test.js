/**
 * EVOCK — human-readable PDF report (Role C, step 07 / C6, spec §19).
 *
 * jsPDF gives no text-extraction API, so `buildPdfReport` returns the lines it
 * drew alongside the bytes. These tests scan that text for every spec §19
 * section in order and for the un-trimmed Limitations page, and assert the byte
 * output is a real, non-trivial PDF.
 */

import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import {
  buildPdfReport,
  CAN_SHOW,
  PDF_SECTIONS,
  pdfReportFilename
} from "../../extension/src/export/pdf-report.js";
import { CANNOT_ESTABLISH } from "../../extension/src/export/verify-readme.txt.js";
import { loadUiFixture, SCREENSHOT_PNG_DATA_URL } from "../helpers/ui-fixtures.js";

const OK_RECORD = loadUiFixture("record.sample.json");
const FAILED_RECORD = loadUiFixture("record.failed-extraction.sample.json");
const VERIFICATION_OK = loadUiFixture("verification.ok.sample.json");

function build(record, verification) {
  return buildPdfReport(
    { record, verification, screenshotDataUrl: SCREENSHOT_PNG_DATA_URL },
    { jsPDF }
  );
}

describe("buildPdfReport — bytes", () => {
  it("produces a non-trivial PDF file", () => {
    const { bytes } = build(OK_RECORD, VERIFICATION_OK);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("puts the Limitations section on its own final page", () => {
    const { text, pages } = build(OK_RECORD, VERIFICATION_OK);
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(text).toContain("Limitations");
    // Limitations comes after every other section.
    const idx = text.indexOf("Limitations");
    const others = PDF_SECTIONS.filter((s) => s !== "Limitations").map((s) => text.indexOf(s));
    expect(Math.max(...others)).toBeLessThan(idx);
  });

  it("filename follows EVOCK-<id>-report.pdf", () => {
    expect(pdfReportFilename("NK-0003")).toBe("EVOCK-NK-0003-report.pdf");
  });
});

describe("buildPdfReport — spec §19 content, in order", () => {
  const { text } = build(OK_RECORD, VERIFICATION_OK);

  it("contains every §19 section", () => {
    for (const section of PDF_SECTIONS) {
      expect(text).toContain(section);
    }
  });

  it("renders the sections in the required order", () => {
    const positions = PDF_SECTIONS.map((s) => text.indexOf(s));
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
    expect(positions.every((p) => p >= 0)).toBe(true);
  });

  it("marks the AI-derived fields as AI-derived", () => {
    expect(text).toContain("AI-derived");
    expect(text).toMatch(/vision model/i);
    expect(text).toContain("[AI-derived] Platform: WhatsApp");
    expect(text).toContain("[AI-derived] Mr. ABC B");
  });

  it("labels the capture time as device capture time, not 'timestamp'", () => {
    expect(text).toContain("Device capture time");
    expect(text).toMatch(/not a trusted timestamp/i);
  });

  it("prints all three SHA-256 hashes in full", () => {
    const m = OK_RECORD.manifest.integrity;
    expect(text).toContain(m.screenshot_hash);
    expect(text).toContain(m.metadata_hash);
    expect(text).toContain(m.manifest_hash);
  });

  it("shows the signature and trusted-timestamp status plainly", () => {
    expect(text).toMatch(/ECDSA P-256/);
    expect(text).toMatch(/Trusted timestamp[\s\S]*Not configured/);
  });

  it("shows the verification result with its date", () => {
    expect(text).toMatch(/Status:\s*VERIFIED/);
    expect(text).toContain("2026"); // verified_at rendered
  });

  it("includes the full Limitations content (spec §27) and does not trim it", () => {
    for (const c of CAN_SHOW) expect(text).toContain(c);
    for (const c of CANNOT_ESTABLISH) expect(text).toContain(c);
    expect(text).toMatch(/does not replace professional forensic examination/i);
  });
});

describe("buildPdfReport — failed extraction", () => {
  const { bytes, text } = build(FAILED_RECORD, null);

  it("still renders a valid PDF", () => {
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("marks the metadata unavailable without calling it a failed capture", () => {
    expect(text).toMatch(/AI extraction unavailable/i);
    expect(text).not.toMatch(/failed capture/i);
  });

  it("still includes hashes, signature and the Limitations page", () => {
    expect(text).toContain(FAILED_RECORD.manifest.integrity.manifest_hash);
    expect(text).toContain("Signature");
    expect(text).toContain("Limitations");
    for (const c of CANNOT_ESTABLISH) expect(text).toContain(c);
  });

  it("reports that the record was not re-verified", () => {
    expect(text).toMatch(/has not been re-verified/i);
  });
});

describe("buildPdfReport — guards", () => {
  it("throws without a jsPDF constructor", () => {
    expect(() => buildPdfReport({ record: OK_RECORD }, { jsPDF: null })).toThrow(/jsPDF/);
  });

  it("throws without a manifest", () => {
    expect(() => buildPdfReport({ record: {} }, { jsPDF })).toThrow(/manifest/);
  });
});
