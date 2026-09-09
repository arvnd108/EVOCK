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

/**
 * A stateful fake mirroring storage/vault-repo.js's real per-record counter
 * semantics: an atomic check-and-increment, throwing once `limit` is reached,
 * keyed independently per evidence_id.
 */
function makeFakeLimitApi(limit = 3) {
  const counts = new Map();
  const api = {
    getStatus: vi.fn(async (id) => {
      const count = counts.get(id) ?? 0;
      return { count, remaining: Math.max(0, limit - count), limit };
    }),
    recordDownload: vi.fn(async (id) => {
      const count = counts.get(id) ?? 0;
      if (count >= limit) {
        const err = new Error(`${id}: already downloaded ${limit} times`);
        err.limitReached = true;
        throw err;
      }
      const next = count + 1;
      counts.set(id, next);
      return { count: next, remaining: Math.max(0, limit - next), limit };
    })
  };
  return api;
}

function makeCtrl(over = {}) {
  const downloader = { save: vi.fn(async () => {}) };
  const buildPdf = vi.fn(() => ({ bytes: new Uint8Array([1, 2, 3]), text: "", pages: 2 }));
  const buildZip = vi.fn(async () => new Uint8Array([4, 5, 6]));
  const encryptForExport = vi.fn(async (bytes) => new Uint8Array([9, 9, ...bytes]));
  const passphraseLimitApi = over.passphraseLimitApi ?? makeFakeLimitApi();
  const exportApi = makeApi(over.apiExtra);
  const ctrl = createExportController({
    exportApi,
    downloader,
    buildPdf,
    buildZip,
    encryptForExport,
    passphraseLimitApi,
    ...over.opts
  });
  return { ctrl, downloader, buildPdf, buildZip, encryptForExport, exportApi, passphraseLimitApi };
}

/** Fill in a matching passphrase pair and click Encrypt & Save. */
function fillAndSubmit(ctrl, passphrase = "correct horse battery staple") {
  const { select, inputs, button } = encControls(ctrl);
  if (select.value !== "pdf" && select.value !== "zip") select.value = "pdf";
  inputs[0].value = passphrase;
  inputs[1].value = passphrase;
  button.click();
}

/** The encrypted-export section's three inputs, in DOM order. */
function encControls(ctrl) {
  return {
    select: ctrl.element.querySelector(".nk-export__enc-select"),
    inputs: ctrl.element.querySelectorAll(".nk-export__enc-input"),
    button: [...ctrl.element.querySelectorAll(".nk-export__btn")].find(
      (b) => b.textContent === "Encrypt & Save"
    )
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createExportController", () => {
  it("open() reveals a PDF and a ZIP action, plus the passphrase-wrap option", () => {
    const { ctrl } = makeCtrl();
    expect(ctrl.element.hidden).toBe(true);
    ctrl.open("NK-0001");
    expect(ctrl.element.hidden).toBe(false);
    const labels = [...ctrl.element.querySelectorAll(".nk-export__btn")].map((b) => b.textContent);
    expect(labels).toEqual([
      "Human-readable report (PDF)",
      "Evidence package (ZIP)",
      "Close",
      "Encrypt & Save"
    ]);
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

describe("createExportController — passphrase-wrapped copy (opt-in third option)", () => {
  it("wraps the selected export's OWN bytes and downloads it under a .enc filename", async () => {
    const { ctrl, downloader, buildPdf, buildZip, encryptForExport } = makeCtrl();
    ctrl.open("NK-0001");
    const { select, inputs, button } = encControls(ctrl);
    select.value = "pdf";
    inputs[0].value = "correct horse battery staple";
    inputs[1].value = "correct horse battery staple";
    button.click();
    await tick();

    // The plain PDF builder ran (same bytes a plain export would produce) —
    // wrapping never re-implements building.
    expect(buildPdf).toHaveBeenCalledTimes(1);
    expect(buildZip).not.toHaveBeenCalled();
    expect(encryptForExport).toHaveBeenCalledTimes(1);
    const [wrappedBytes, passphrase] = encryptForExport.mock.calls[0];
    expect(Array.from(wrappedBytes)).toEqual([1, 2, 3]); // the built PDF bytes from makeCtrl
    expect(passphrase).toBe("correct horse battery staple");

    expect(downloader.save).toHaveBeenCalledTimes(1);
    const [savedBytes, mime, filename] = downloader.save.mock.calls[0];
    expect(Array.from(savedBytes)).toEqual([9, 9, 1, 2, 3]); // encryptForExport's fake wrap
    expect(mime).toBe("application/octet-stream");
    expect(filename).toBe("EVOCK-NK-0001-report.pdf.enc");
  });

  it("can wrap the ZIP package instead, selected via the dropdown", async () => {
    const { ctrl, downloader, buildZip } = makeCtrl();
    ctrl.open("NK-0001");
    const { select, inputs, button } = encControls(ctrl);
    select.value = "zip";
    inputs[0].value = "correct horse battery staple";
    inputs[1].value = "correct horse battery staple";
    button.click();
    await tick();

    expect(buildZip).toHaveBeenCalledTimes(1);
    const [, , filename] = downloader.save.mock.calls[0];
    expect(filename).toBe("EVOCK-NK-0001-package.zip.enc");
  });

  it("refuses a too-short passphrase without building anything or downloading", async () => {
    const { ctrl, downloader, buildPdf } = makeCtrl();
    ctrl.open("NK-0001");
    const { inputs, button } = encControls(ctrl);
    inputs[0].value = "short";
    inputs[1].value = "short";
    button.click();
    await tick();

    expect(buildPdf).not.toHaveBeenCalled();
    expect(downloader.save).not.toHaveBeenCalled();
    const status = ctrl.element.querySelector(".nk-export__enc .nk-export__status");
    expect(status.textContent).toMatch(/at least \d+ characters/i);
  });

  it("refuses mismatched passphrase entries without building anything or downloading", async () => {
    const { ctrl, downloader, buildPdf } = makeCtrl();
    ctrl.open("NK-0001");
    const { inputs, button } = encControls(ctrl);
    inputs[0].value = "correct horse battery staple";
    inputs[1].value = "a totally different phrase";
    button.click();
    await tick();

    expect(buildPdf).not.toHaveBeenCalled();
    expect(downloader.save).not.toHaveBeenCalled();
    const status = ctrl.element.querySelector(".nk-export__enc .nk-export__status");
    expect(status.textContent).toMatch(/do not match/i);
  });

  it("clears both passphrase fields after a successful export (never lingers in the DOM)", async () => {
    const { ctrl } = makeCtrl();
    ctrl.open("NK-0001");
    const { inputs, button } = encControls(ctrl);
    inputs[0].value = "correct horse battery staple";
    inputs[1].value = "correct horse battery staple";
    button.click();
    await tick();

    expect(inputs[0].value).toBe("");
    expect(inputs[1].value).toBe("");
  });

  it("surfaces an encryption failure without downloading, and does not disable the plain buttons", async () => {
    const encryptForExport = vi.fn(async () => Promise.reject(new Error("crypto.subtle unavailable")));
    const { ctrl, downloader } = makeCtrl({ opts: { encryptForExport } });
    ctrl.open("NK-0001");
    const { inputs, button } = encControls(ctrl);
    inputs[0].value = "correct horse battery staple";
    inputs[1].value = "correct horse battery staple";
    button.click();
    await tick();

    expect(downloader.save).not.toHaveBeenCalled();
    const status = ctrl.element.querySelector(".nk-export__enc .nk-export__status");
    expect(status.textContent).toMatch(/did not complete: crypto\.subtle unavailable/i);
    expect(ctrl.element.querySelectorAll(".nk-export__btn")[0].disabled).toBe(false);
  });

  it("open() and close() reset the passphrase fields so a stale value cannot survive between records", async () => {
    const { ctrl } = makeCtrl();
    ctrl.open("NK-0001");
    const { inputs } = encControls(ctrl);
    inputs[0].value = "correct horse battery staple";
    inputs[1].value = "correct horse battery staple";

    ctrl.close();
    ctrl.open("NK-0002");
    const again = encControls(ctrl);
    expect(again.inputs[0].value).toBe("");
    expect(again.inputs[1].value).toBe("");
  });

  it("the plain PDF/ZIP buttons are unaffected — still save the unwrapped bytes", async () => {
    // Regression guard: adding the wrap option must not change what the two
    // original buttons do.
    const { ctrl, downloader, encryptForExport } = makeCtrl();
    ctrl.open("NK-0001");
    ctrl.element.querySelectorAll(".nk-export__btn")[0].click();
    await tick();

    expect(encryptForExport).not.toHaveBeenCalled();
    const [bytes, mime, filename] = downloader.save.mock.calls[0];
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(mime).toBe("application/pdf");
    expect(filename).toBe("EVOCK-NK-0001-report.pdf"); // no .enc suffix
  });
});

describe("createExportController — passphrase-wrap download limit (max 3 per record)", () => {
  it("shows the remaining count once the panel opens, before any attempt", async () => {
    const { ctrl } = makeCtrl();
    ctrl.open("NK-0001");
    await tick();

    const note = ctrl.element.querySelector(".nk-export__enc-limit");
    expect(note.textContent).toMatch(/0 of 3.*3 remaining/i);
  });

  it("allows exactly 3 downloads, then disables the section and refuses a 4th", async () => {
    const { ctrl, downloader, encryptForExport } = makeCtrl();
    ctrl.open("NK-0001");
    await tick();

    for (let i = 1; i <= 3; i++) {
      fillAndSubmit(ctrl);
      await tick();
      expect(downloader.save).toHaveBeenCalledTimes(i);
    }

    const { select, inputs, button } = encControls(ctrl);
    expect(button.disabled).toBe(true);
    expect(select.disabled).toBe(true);
    expect(inputs[0].disabled).toBe(true);
    expect(inputs[1].disabled).toBe(true);

    const note = ctrl.element.querySelector(".nk-export__enc-limit");
    expect(note.textContent).toMatch(/maximum of 3.*used/i);

    // A disabled button does not dispatch click handlers — a 4th attempt
    // cannot even reach runEncrypted().
    const callsBefore = encryptForExport.mock.calls.length;
    button.click();
    await tick();
    expect(encryptForExport.mock.calls.length).toBe(callsBefore);
    expect(downloader.save).toHaveBeenCalledTimes(3);
  });

  it("the plain PDF/ZIP export stays available after the wrap limit is hit", async () => {
    const { ctrl, downloader } = makeCtrl();
    ctrl.open("NK-0001");
    await tick();
    for (let i = 0; i < 3; i++) {
      fillAndSubmit(ctrl);
      await tick();
    }
    downloader.save.mockClear();

    ctrl.element.querySelectorAll(".nk-export__btn")[0].click(); // plain PDF button
    await tick();

    expect(downloader.save).toHaveBeenCalledTimes(1);
    const [, , filename] = downloader.save.mock.calls[0];
    expect(filename).toBe("EVOCK-NK-0001-report.pdf");
  });

  it("the limit is tracked per record, not shared across the whole vault", async () => {
    const passphraseLimitApi = makeFakeLimitApi();
    const { ctrl, downloader } = makeCtrl({ passphraseLimitApi });
    ctrl.open("NK-0001");
    await tick();
    for (let i = 0; i < 3; i++) {
      fillAndSubmit(ctrl);
      await tick();
    }
    expect(encControls(ctrl).button.disabled).toBe(true);

    // A different record starts fresh, even sharing the same backing api.
    ctrl.open("NK-0002");
    await tick();
    expect(encControls(ctrl).button.disabled).toBe(false);
    const note = ctrl.element.querySelector(".nk-export__enc-limit");
    expect(note.textContent).toMatch(/0 of 3.*3 remaining/i);

    fillAndSubmit(ctrl);
    await tick();
    const [, , filename] = downloader.save.mock.calls.at(-1);
    expect(filename).toBe("EVOCK-NK-0002-report.pdf.enc");
  });

  it("counts a download only after chrome.downloads actually received the file", async () => {
    // If build/encrypt fails BEFORE downloader.save, no attempt is spent.
    const encryptForExport = vi.fn(async () => Promise.reject(new Error("boom")));
    const passphraseLimitApi = makeFakeLimitApi();
    const { ctrl } = makeCtrl({ opts: { encryptForExport }, passphraseLimitApi });
    ctrl.open("NK-0001");
    await tick();

    fillAndSubmit(ctrl);
    await tick();

    expect(passphraseLimitApi.recordDownload).not.toHaveBeenCalled();
    const status = await passphraseLimitApi.getStatus("NK-0001");
    expect(status.count).toBe(0);
  });

  it("if recordDownload itself fails after a real save, the file is still reported saved", async () => {
    const passphraseLimitApi = {
      getStatus: vi.fn(async () => ({ count: 0, remaining: 3, limit: 3 })),
      recordDownload: vi.fn(async () => Promise.reject(new Error("worker offline")))
    };
    const { ctrl, downloader } = makeCtrl({ passphraseLimitApi });
    ctrl.open("NK-0001");
    await tick();

    fillAndSubmit(ctrl);
    await tick();

    expect(downloader.save).toHaveBeenCalledTimes(1); // the file WAS saved
    const status = ctrl.element.querySelector(".nk-export__enc .nk-export__status");
    expect(status.textContent).toMatch(/Saved.*but the download count could not be updated/i);
    // A bookkeeping failure must not lock the user out of trying again.
    expect(encControls(ctrl).button.disabled).toBe(false);
  });

  it("a getStatus failure does not block the flow (best-effort UI only)", async () => {
    const passphraseLimitApi = {
      getStatus: vi.fn(async () => Promise.reject(new Error("offline"))),
      recordDownload: vi.fn(async () => ({ count: 1, remaining: 2, limit: 3 }))
    };
    const { ctrl, downloader } = makeCtrl({ passphraseLimitApi });
    ctrl.open("NK-0001");
    await tick();

    fillAndSubmit(ctrl);
    await tick();

    expect(downloader.save).toHaveBeenCalledTimes(1);
  });
});
