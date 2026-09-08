// @vitest-environment jsdom
/**
 * EVOCK — export menu + download glue (Role C, step 07 / C6).
 *
 * Everything is behind seams: no chrome.*, no real jsPDF / JSZip.
 */

import { describe, expect, it, vi } from "vitest";
import { createExportController } from "../../extension/src/vault/components/export-controller.js";
import { loadUiFixture } from "../helpers/ui-fixtures.js";

const RECORD = loadUiFixture("record.sample.json");

function makeApi(extra = {}) {
  return {
    getForExport: vi.fn(async () => ({
      ok: true,
      manifest: RECORD.manifest,
      last_verification: loadUiFixture("verification.ok.sample.json"),
      screenshotDataUrl: "data:image/png;base64,AAAA",
      screenshot_ciphertext: "AAAA",
      iv: "BBBB",
      ...extra
    }))
  };
}

function makeCtrl(over = {}) {
  const downloader = { save: vi.fn(async () => {}) };
  const buildPdf = vi.fn(() => ({ bytes: new Uint8Array([1, 2, 3]), text: "", pages: 2 }));
  const buildZip = vi.fn(async () => new Uint8Array([4, 5, 6]));
  const exportApi = makeApi(over.apiExtra);
  const ctrl = createExportController({ exportApi, downloader, buildPdf, buildZip, ...over.opts });
  return { ctrl, downloader, buildPdf, buildZip, exportApi };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createExportController", () => {
  it("open() reveals a PDF and a ZIP action", () => {
    const { ctrl } = makeCtrl();
    expect(ctrl.element.hidden).toBe(true);
    ctrl.open("NK-0001");
    expect(ctrl.element.hidden).toBe(false);
    const labels = [...ctrl.element.querySelectorAll(".nk-export__btn")].map((b) => b.textContent);
    expect(labels).toEqual(["Human-readable report (PDF)", "Evidence package (ZIP)", "Close"]);
  });

  it("PDF: gathers the record, builds, and downloads EVOCK-<id>-report.pdf", async () => {
    const { ctrl, downloader, buildPdf, exportApi } = makeCtrl();
    ctrl.open("NK-0001");
    ctrl.element.querySelectorAll(".nk-export__btn")[0].click();
    await tick();

    expect(exportApi.getForExport).toHaveBeenCalledWith("NK-0001");
    expect(buildPdf).toHaveBeenCalledTimes(1);
    expect(buildPdf.mock.calls[0][0].screenshotDataUrl).toBe("data:image/png;base64,AAAA");
    expect(downloader.save).toHaveBeenCalledTimes(1);
    const [bytes, mime, filename] = downloader.save.mock.calls[0];
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(mime).toBe("application/pdf");
    expect(filename).toBe("EVOCK-NK-0001-report.pdf");
    expect(ctrl.element.querySelector(".nk-export__status").textContent).toMatch(/Saved/);
  });

  it("ZIP: builds and downloads EVOCK-<id>-package.zip", async () => {
    const { ctrl, downloader, buildZip } = makeCtrl();
    ctrl.open("NK-0001");
    ctrl.element.querySelectorAll(".nk-export__btn")[1].click();
    await tick();

    expect(buildZip).toHaveBeenCalledTimes(1);
    const [, mime, filename] = downloader.save.mock.calls[0];
    expect(mime).toBe("application/zip");
    expect(filename).toBe("EVOCK-NK-0001-package.zip");
  });

  it("ZIP without ciphertext fails gracefully and does not download", async () => {
    const { ctrl, downloader, buildZip } = makeCtrl({ apiExtra: { screenshot_ciphertext: null } });
    ctrl.open("NK-0001");
    ctrl.element.querySelectorAll(".nk-export__btn")[1].click();
    await tick();

    expect(buildZip).not.toHaveBeenCalled();
    expect(downloader.save).not.toHaveBeenCalled();
    expect(ctrl.element.querySelector(".nk-export__status").textContent).toMatch(
      /did not complete/i
    );
  });

  it("a load failure is surfaced, not thrown, and nothing downloads", async () => {
    const exportApi = {
      getForExport: vi.fn(async () => Promise.reject(new Error("worker offline")))
    };
    const downloader = { save: vi.fn() };
    const ctrl = createExportController({
      exportApi,
      downloader,
      buildPdf: vi.fn(),
      buildZip: vi.fn()
    });
    ctrl.open("NK-0001");
    ctrl.element.querySelectorAll(".nk-export__btn")[0].click();
    await tick();

    expect(downloader.save).not.toHaveBeenCalled();
    expect(ctrl.element.querySelector(".nk-export__status").textContent).toMatch(
      /did not complete: worker offline/i
    );
  });

  it("ignores a second click while a build is in flight", async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const exportApi = {
      getForExport: vi.fn(async () => {
        await gate;
        return {
          ok: true,
          manifest: RECORD.manifest,
          last_verification: null,
          screenshotDataUrl: "x"
        };
      })
    };
    const buildPdf = vi.fn(() => ({ bytes: new Uint8Array([1]), text: "", pages: 1 }));
    const downloader = { save: vi.fn(async () => {}) };
    const ctrl = createExportController({ exportApi, downloader, buildPdf, buildZip: vi.fn() });
    ctrl.open("NK-0001");
    const pdfBtn = ctrl.element.querySelectorAll(".nk-export__btn")[0];
    pdfBtn.click();
    pdfBtn.click();
    release();
    await tick();

    expect(exportApi.getForExport).toHaveBeenCalledTimes(1);
    expect(buildPdf).toHaveBeenCalledTimes(1);
  });

  it("close() hides the panel", () => {
    const { ctrl } = makeCtrl();
    ctrl.open("NK-0001");
    ctrl.element.querySelectorAll(".nk-export__btn")[2].click();
    expect(ctrl.element.hidden).toBe(true);
  });
});
