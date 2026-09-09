/**
 * EVOCK — service-worker orchestrator tests (Role A, A7).
 *
 * The real capture, extraction and evidence-core modules are mocked: this suite
 * proves the SEQUENCING and the failure guarantees, not the internals of the
 * steps (those have their own suites).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadFixture } from "../helpers/fixtures.js";

const capture = () => loadFixture("capture.sample");
const extractionOk = () => loadFixture("extraction.ok.sample");

// --- mocks -----------------------------------------------------------------
const captureVisibleTab = vi.fn();
const extract = vi.fn();
const getProvider = vi.fn(() => ({ id: "vision", extract }));
const getSelectedProviderId = vi.fn(async () => "vision");
const lockEvidence = vi.fn();
const verifyEvidence = vi.fn();
const reviseMetadata = vi.fn();
const normalizeVersions = vi.fn((record) => record?.versions ?? [{ version: 1, origin: "ai" }]);
const vaultList = vi.fn();
const vaultGet = vi.fn();
const vaultGetScreenshot = vi.fn();
const vaultRemove = vi.fn();
const vaultClear = vi.fn();
const vaultGetPassphraseExportStatus = vi.fn();
const vaultRecordPassphraseExport = vi.fn();

vi.mock("../../extension/src/capture/capture.js", () => ({
  captureVisibleTab: (...a) => captureVisibleTab(...a)
}));
vi.mock("../../extension/src/extraction/provider.js", async () => {
  const actual = await vi.importActual("../../extension/src/extraction/provider.js");
  return {
    ...actual,
    getProvider: (...a) => getProvider(...a),
    getSelectedProviderId: (...a) => getSelectedProviderId(...a)
  };
});
vi.mock("../../extension/src/evidence/index.js", () => ({
  lockEvidence: (...a) => lockEvidence(...a),
  verifyEvidence: (...a) => verifyEvidence(...a),
  reviseMetadata: (...a) => reviseMetadata(...a),
  normalizeVersions: (...a) => normalizeVersions(...a)
}));
vi.mock("../../extension/src/storage/vault-repo.js", () => ({
  list: (...a) => vaultList(...a),
  get: (...a) => vaultGet(...a),
  getDecryptedScreenshot: (...a) => vaultGetScreenshot(...a),
  remove: (...a) => vaultRemove(...a),
  clear: (...a) => vaultClear(...a),
  getPassphraseExportStatus: (...a) => vaultGetPassphraseExportStatus(...a),
  recordPassphraseExport: (...a) => vaultRecordPassphraseExport(...a)
}));

// --- chrome stub ---------------------------------------------------------
let progressEvents;
let sessionStore;

function installChrome() {
  progressEvents = [];
  sessionStore = {};
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage: vi.fn(async (msg) => {
        if (msg?.type === "PRESERVE_PROGRESS") progressEvents.push(msg.payload);
      })
      // no onMessage → the module does not self-register a listener on import
    },
    storage: {
      session: {
        get: vi.fn(async (k) => ({ [k]: sessionStore[k] })),
        set: vi.fn(async (obj) => Object.assign(sessionStore, obj)),
        remove: vi.fn(async (k) => {
          delete sessionStore[k];
        })
      }
    }
  });
}

let preserve;
let handleMessage;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  installChrome();
  getProvider.mockReturnValue({ id: "vision", extract });
  getSelectedProviderId.mockResolvedValue("vision");
  ({ preserve, handleMessage } = await import(
    "../../extension/src/background/service-worker.js"
  ));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const stagesOf = () => progressEvents.map((e) => `${e.stage}:${e.ok ?? "active"}`);

describe("preserve() — happy path", () => {
  it("runs capture → extract → lock and returns the evidence id", async () => {
    captureVisibleTab.mockResolvedValue(capture());
    extract.mockResolvedValue(extractionOk());
    lockEvidence.mockResolvedValue({ evidence_id: "NK-0007", manifest: {} });

    const res = await preserve();

    expect(res).toMatchObject({ ok: true, evidence_id: "NK-0007", degraded: false });
    expect(lockEvidence).toHaveBeenCalledTimes(1);
    expect(lockEvidence.mock.calls[0][0].extraction.status).toBe("ok");
  });

  it("emits a PRESERVE_PROGRESS event for every pipeline stage", async () => {
    captureVisibleTab.mockResolvedValue(capture());
    extract.mockResolvedValue(extractionOk());
    // drive the lock progress bridge the way lockEvidence really does
    lockEvidence.mockImplementation(async ({ emit }) => {
      ["hash", "encrypt", "sign", "timestamp", "store"].forEach((s) => emit(s));
      return { evidence_id: "NK-0008", manifest: {} };
    });

    await preserve();

    for (const s of ["capture", "extract", "hash", "encrypt", "sign", "timestamp", "store"]) {
      expect(progressEvents.some((e) => e.stage === s)).toBe(true);
    }
    // capture and store both reach a done state
    expect(stagesOf()).toContain("capture:true");
    expect(stagesOf()).toContain("store:true");
  });

  it("clears the session mirror after a successful run", async () => {
    captureVisibleTab.mockResolvedValue(capture());
    extract.mockResolvedValue(extractionOk());
    lockEvidence.mockResolvedValue({ evidence_id: "NK-0009", manifest: {} });

    await preserve();
    expect(sessionStore["evock:inflight"]).toBeUndefined();
  });
});

describe("preserve() — extraction failure never stops the pipeline", () => {
  it("a thrown provider error becomes status:failed and lock still runs", async () => {
    captureVisibleTab.mockResolvedValue(capture());
    extract.mockRejectedValue(new Error("bridge offline"));
    lockEvidence.mockResolvedValue({ evidence_id: "NK-0010", manifest: {} });

    const res = await preserve();

    expect(res.ok).toBe(true);
    expect(res.evidence_id).toBe("NK-0010");
    expect(res.extraction.status).toBe("failed");
    expect(res.extraction.provider).toBe("vision"); // never "unknown" (deviation A)
    expect(lockEvidence.mock.calls[0][0].extraction.status).toBe("failed");
    const extractEvent = progressEvents.find((e) => e.stage === "extract" && e.ok === false);
    expect(extractEvent).toBeTruthy();
  });
});

describe("preserve() — screenshot-only fallback", () => {
  it("retries once without the extraction payload when the first lock throws", async () => {
    captureVisibleTab.mockResolvedValue(capture());
    extract.mockResolvedValue(extractionOk());
    lockEvidence
      .mockRejectedValueOnce(new Error("manifest builder choked on the payload"))
      .mockResolvedValueOnce({ evidence_id: "NK-0011", manifest: {} });

    const res = await preserve();

    expect(res).toMatchObject({ ok: true, evidence_id: "NK-0011", degraded: true });
    expect(lockEvidence).toHaveBeenCalledTimes(2);
    expect(lockEvidence.mock.calls[1][0].extraction.status).toBe("failed");
  });

  it("surfaces an error but still returns the capture when both locks fail", async () => {
    captureVisibleTab.mockResolvedValue(capture());
    extract.mockResolvedValue(extractionOk());
    lockEvidence.mockRejectedValue(new Error("IndexedDB unavailable"));

    const res = await preserve();

    expect(res.ok).toBe(false);
    expect(res.degraded).toBe(true);
    expect(res.capture).toBeTruthy();
    expect(res.error).toMatch(/IndexedDB unavailable/);
    expect(sessionStore["evock:inflight"]).toBeUndefined();
  });

  it("does not retry when extraction had already failed (fault is downstream)", async () => {
    captureVisibleTab.mockResolvedValue(capture());
    extract.mockRejectedValue(new Error("bridge offline"));
    lockEvidence.mockRejectedValue(new Error("crypto.subtle missing"));

    const res = await preserve();

    expect(res.ok).toBe(false);
    expect(lockEvidence).toHaveBeenCalledTimes(1);
  });
});

describe("preserve() — capture failure is the only fatal outcome", () => {
  it("returns ok:false with no capture and never calls lock", async () => {
    captureVisibleTab.mockRejectedValue(new Error("This page cannot be captured by browser extensions."));

    const res = await preserve();

    expect(res.ok).toBe(false);
    expect(res.capture).toBeUndefined();
    expect(res.error).toMatch(/cannot be captured/);
    expect(lockEvidence).not.toHaveBeenCalled();
    expect(stagesOf()).toContain("capture:false");
  });
});

describe("handleMessage routing", () => {
  it("PRESERVE_START resolves the pipeline result through sendResponse", async () => {
    captureVisibleTab.mockResolvedValue(capture());
    extract.mockResolvedValue(extractionOk());
    lockEvidence.mockResolvedValue({ evidence_id: "NK-0012", manifest: {} });

    const sendResponse = vi.fn();
    const async = handleMessage({ type: "PRESERVE_START" }, {}, sendResponse);
    expect(async).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls[0][0]).toMatchObject({ ok: true, evidence_id: "NK-0012" });
  });

  it("LIST_EVIDENCE delegates to vaultRepo.list", async () => {
    vaultList.mockResolvedValue([{ evidence_id: "NK-0001" }]);
    const sendResponse = vi.fn();
    handleMessage({ type: "LIST_EVIDENCE", payload: {} }, {}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls[0][0]).toEqual({ ok: true, items: [{ evidence_id: "NK-0001" }] });
  });

  it("GET_EVIDENCE returns the record plus its version list", async () => {
    vaultGet.mockResolvedValue({
      manifest: { integrity: {} },
      created_at: "2026-09-08T10:00:00+05:30",
      platform_label: "WhatsApp",
      last_verification: null,
      versions: [
        { version: 1, origin: "ai" },
        { version: 2, origin: "human" }
      ]
    });
    vaultGetScreenshot.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));

    const sendResponse = vi.fn();
    handleMessage({ type: "GET_EVIDENCE", payload: { evidence_id: "NK-0001" } }, {}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    const res = sendResponse.mock.calls[0][0];
    expect(res.ok).toBe(true);
    expect(normalizeVersions).toHaveBeenCalledTimes(1);
    expect(res.versions).toHaveLength(2);
    expect(res.screenshotDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("VERIFY_EVIDENCE forwards the requested version to verifyEvidence", async () => {
    // Regression guard: the detail panel lets a user select and verify an
    // OLDER version. If `version` is dropped here, verifyEvidence silently
    // falls back to the latest, and the panel ends up comparing a recorded
    // hash from the old manifest against a current hash recomputed for the
    // latest — reporting a correctly-signed old version as MODIFIED.
    verifyEvidence.mockResolvedValue({ status: "VERIFIED" });
    const sendResponse = vi.fn();
    handleMessage(
      { type: "VERIFY_EVIDENCE", payload: { evidence_id: "NK-0001", version: 1 } },
      {},
      sendResponse
    );
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    expect(verifyEvidence).toHaveBeenCalledWith("NK-0001", { version: 1 });
    expect(sendResponse.mock.calls[0][0]).toEqual({ ok: true, result: { status: "VERIFIED" } });
  });

  it("VERIFY_EVIDENCE with no version passes version:undefined (verifies latest, persists)", async () => {
    verifyEvidence.mockResolvedValue({ status: "VERIFIED" });
    const sendResponse = vi.fn();
    handleMessage(
      { type: "VERIFY_EVIDENCE", payload: { evidence_id: "NK-0001" } },
      {},
      sendResponse
    );
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    expect(verifyEvidence).toHaveBeenCalledWith("NK-0001", { version: undefined });
  });

  it("REVISE_METADATA routes to reviseMetadata and returns the updated record", async () => {
    const updated = { evidence_id: "NK-0001", versions: [{ version: 1 }, { version: 2 }] };
    reviseMetadata.mockResolvedValue(updated);

    const sendResponse = vi.fn();
    const async = handleMessage(
      {
        type: "REVISE_METADATA",
        payload: { evidence_id: "NK-0001", data: { platform: "WhatsApp" }, note: "fixed the name" }
      },
      {},
      sendResponse
    );
    expect(async).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    expect(reviseMetadata).toHaveBeenCalledWith(
      "NK-0001",
      { platform: "WhatsApp" },
      { note: "fixed the name" }
    );
    expect(sendResponse.mock.calls[0][0]).toEqual({ ok: true, record: updated });
  });

  it("REVISE_METADATA surfaces a failure as { ok: false, error }", async () => {
    reviseMetadata.mockRejectedValue(new Error("signing key unavailable"));

    const sendResponse = vi.fn();
    handleMessage(
      { type: "REVISE_METADATA", payload: { evidence_id: "NK-0001", data: {} } },
      {},
      sendResponse
    );
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    expect(sendResponse.mock.calls[0][0]).toEqual({
      ok: false,
      error: "signing key unavailable"
    });
  });

  it("DELETE_EVIDENCE delegates to vaultRepo.remove and replies { ok: true }", async () => {
    vaultRemove.mockResolvedValue(undefined);
    const sendResponse = vi.fn();
    const async = handleMessage(
      { type: "DELETE_EVIDENCE", payload: { evidence_id: "NK-0002" } },
      {},
      sendResponse
    );
    expect(async).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(vaultRemove).toHaveBeenCalledWith("NK-0002");
    expect(sendResponse.mock.calls[0][0]).toEqual({ ok: true });
  });

  it("DELETE_EVIDENCE surfaces a failure as { ok: false, error }", async () => {
    vaultRemove.mockRejectedValue(new Error("IndexedDB unavailable"));
    const sendResponse = vi.fn();
    handleMessage({ type: "DELETE_EVIDENCE", payload: { evidence_id: "NK-0002" } }, {}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls[0][0]).toEqual({
      ok: false,
      error: "IndexedDB unavailable"
    });
  });

  it("CLEAR_VAULT delegates to vaultRepo.clear and replies { ok: true }", async () => {
    vaultClear.mockResolvedValue(undefined);
    const sendResponse = vi.fn();
    const async = handleMessage({ type: "CLEAR_VAULT", payload: {} }, {}, sendResponse);
    expect(async).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(vaultClear).toHaveBeenCalledTimes(1);
    expect(sendResponse.mock.calls[0][0]).toEqual({ ok: true });
  });

  it("CLEAR_VAULT surfaces a failure as { ok: false, error }", async () => {
    vaultClear.mockRejectedValue(new Error("clear failed"));
    const sendResponse = vi.fn();
    handleMessage({ type: "CLEAR_VAULT", payload: {} }, {}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls[0][0]).toEqual({ ok: false, error: "clear failed" });
  });

  it("GET_PASSPHRASE_EXPORT_STATUS delegates to vaultRepo.getPassphraseExportStatus", async () => {
    vaultGetPassphraseExportStatus.mockResolvedValue({ count: 1, remaining: 2, limit: 3 });
    const sendResponse = vi.fn();
    handleMessage(
      { type: "GET_PASSPHRASE_EXPORT_STATUS", payload: { evidence_id: "NK-0001" } },
      {},
      sendResponse
    );
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    expect(vaultGetPassphraseExportStatus).toHaveBeenCalledWith("NK-0001");
    expect(sendResponse.mock.calls[0][0]).toEqual({ ok: true, count: 1, remaining: 2, limit: 3 });
  });

  it("GET_PASSPHRASE_EXPORT_STATUS surfaces a failure as { ok: false, error }", async () => {
    vaultGetPassphraseExportStatus.mockRejectedValue(new Error("db unavailable"));
    const sendResponse = vi.fn();
    handleMessage(
      { type: "GET_PASSPHRASE_EXPORT_STATUS", payload: { evidence_id: "NK-0001" } },
      {},
      sendResponse
    );
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls[0][0]).toEqual({ ok: false, error: "db unavailable" });
  });

  it("RECORD_PASSPHRASE_EXPORT delegates to vaultRepo.recordPassphraseExport", async () => {
    vaultRecordPassphraseExport.mockResolvedValue({ count: 2, remaining: 1, limit: 3 });
    const sendResponse = vi.fn();
    handleMessage(
      { type: "RECORD_PASSPHRASE_EXPORT", payload: { evidence_id: "NK-0001" } },
      {},
      sendResponse
    );
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    expect(vaultRecordPassphraseExport).toHaveBeenCalledWith("NK-0001");
    expect(sendResponse.mock.calls[0][0]).toEqual({ ok: true, count: 2, remaining: 1, limit: 3 });
  });

  it("RECORD_PASSPHRASE_EXPORT reports a limit-reached error distinctly from a generic failure", async () => {
    // Regression guard: the popup/vault UI branches on `limitReached` to show
    // "maximum reached" rather than a generic transport-error message.
    const limitError = new Error("NK-0001: already downloaded 3 times, which is the maximum.");
    limitError.name = "PassphraseExportLimitError";
    limitError.limit = 3;
    vaultRecordPassphraseExport.mockRejectedValue(limitError);

    const sendResponse = vi.fn();
    handleMessage(
      { type: "RECORD_PASSPHRASE_EXPORT", payload: { evidence_id: "NK-0001" } },
      {},
      sendResponse
    );
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    expect(sendResponse.mock.calls[0][0]).toEqual({
      ok: false,
      error: limitError.message,
      limitReached: true,
      limit: 3
    });
  });

  it("RECORD_PASSPHRASE_EXPORT surfaces a non-limit failure as a generic { ok: false, error }", async () => {
    vaultRecordPassphraseExport.mockRejectedValue(new Error("db unavailable"));
    const sendResponse = vi.fn();
    handleMessage(
      { type: "RECORD_PASSPHRASE_EXPORT", payload: { evidence_id: "NK-0001" } },
      {},
      sendResponse
    );
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    expect(sendResponse.mock.calls[0][0]).toEqual({ ok: false, error: "db unavailable" });
  });

  it("ignores unknown message types", () => {
    const sendResponse = vi.fn();
    expect(handleMessage({ type: "NOPE" }, {}, sendResponse)).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });
});
