/**
 * EVOCK — export copy audit (Role C, step 07 / C6, Task 4; pre-run of step 08).
 *
 * Every string the PDF and the ZIP README emit is subject to the spec §36 audit.
 * The forbidden claims — "court-admissible", "proves", "guarantee(d)",
 * "(process) locally", "recover(s) deleted" — may appear ONLY inside an explicit
 * "cannot" / "does not" sentence. This test greps the generated text and fails
 * on any bare hit.
 */

import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import { buildPdfReport } from "../../extension/src/export/pdf-report.js";
import { buildVerifyReadme } from "../../extension/src/export/verify-readme.txt.js";
import { loadUiFixture, SCREENSHOT_PNG_DATA_URL } from "../helpers/ui-fixtures.js";

const FORBIDDEN = /admissib|proves|guarantee|locally|recover/i;
const NEGATED =
  /\b(cannot|can not|does not|do not|is not|are not|was not|were not|no\b|not\b|never)\b/i;

function auditLines(label, textBlock) {
  const bare = [];
  for (const line of textBlock.split("\n")) {
    if (FORBIDDEN.test(line) && !NEGATED.test(line)) bare.push(line.trim());
  }
  return { label, bare };
}

describe("export copy audit (spec §36)", () => {
  const okPdf = buildPdfReport(
    {
      record: loadUiFixture("record.sample.json"),
      verification: loadUiFixture("verification.ok.sample.json"),
      screenshotDataUrl: SCREENSHOT_PNG_DATA_URL
    },
    { jsPDF }
  ).text;

  const failedPdf = buildPdfReport(
    { record: loadUiFixture("record.failed-extraction.sample.json"), verification: null },
    { jsPDF }
  ).text;

  const readme = buildVerifyReadme({ evidence_id: "NK-0003" });

  it("the PDF report contains no bare forbidden claim", () => {
    expect(auditLines("pdf(ok)", okPdf).bare).toEqual([]);
    expect(auditLines("pdf(failed)", failedPdf).bare).toEqual([]);
  });

  it("the package README contains no bare forbidden claim", () => {
    expect(auditLines("readme", readme).bare).toEqual([]);
  });

  it("uses the approved framing at least once", () => {
    expect(`${okPdf}\n${readme}`).toMatch(/tamper-evident evidence package/i);
    expect(`${okPdf}\n${readme}`).toMatch(/designed to support reporting and investigation/i);
  });
});
