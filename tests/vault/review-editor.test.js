// @vitest-environment jsdom
/**
 * EVOCK — human review / edit of AI metadata (Role C, step 06 / C4).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createReviewController,
  renderReviewEditor,
  renderVersionHistory
} from "../../extension/src/vault/components/review-editor.js";
import { createDetailPanel } from "../../extension/src/vault/components/detail-panel.js";
import { loadUiFixture } from "../helpers/ui-fixtures.js";

const VERSIONED = loadUiFixture("record.versioned.sample.json");
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==";

function v1() {
  return VERSIONED.versions[0].manifest.ai_derived_metadata.data;
}

describe("renderReviewEditor", () => {
  it("prefills the fields from the current data", () => {
    const form = renderReviewEditor(v1());
    const val = (label) =>
      [...form.querySelectorAll(".nk-review__field")]
        .find((f) => f.querySelector(".nk-review__label").textContent === label)
        .querySelector("input").value;
    expect(val("Platform")).toBe("WhatsApp");
    expect(val("Contact")).toBe("Mr. ABC B");
    expect(form.querySelectorAll(".nk-review__message")).toHaveLength(2);
    expect(form.querySelector(".nk-review__msg-text").value).toBe("Dont try to hide");
  });

  it("Save emits the full corrected data with the edited field changed and the rest intact", () => {
    const onSave = vi.fn();
    const form = renderReviewEditor(v1(), { onSave });

    const contact = [...form.querySelectorAll(".nk-review__field")]
      .find((f) => f.querySelector(".nk-review__label").textContent === "Contact")
      .querySelector("input");
    contact.value = "Mr. A. Bakshi";
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const [data, opts] = onSave.mock.calls[0];
    expect(data.contact_name).toBe("Mr. A. Bakshi");
    expect(data.platform).toBe("WhatsApp");
    expect(data.messages).toHaveLength(2);
    expect(data.messages[0]).toMatchObject({ text: "Dont try to hide", type: "incoming" });
    expect(data.visible_time).toBe("11:28 PM");
    expect(opts).toEqual({ note: null });
  });

  it("Cancel calls onCancel and never onSave", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const form = renderReviewEditor(v1(), { onSave, onCancel });
    form.querySelector(".nk-review__cancel").click();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("blank data → blank form that still submits a well-formed shape", () => {
    const onSave = vi.fn();
    const form = renderReviewEditor(null, { onSave });
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(onSave.mock.calls[0][0]).toEqual({
      platform: null,
      contact_name: null,
      messages: [],
      visible_time: null,
      date: null
    });
  });
});

describe("renderVersionHistory", () => {
  const el = renderVersionHistory(VERSIONED.versions, { selected: 2, onSelect: () => {} });

  it("lists a row per version with origin, signed time and signed status", () => {
    const rows = [...el.querySelectorAll(".nk-versions__row")];
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector(".nk-versions__tag").textContent).toBe("v1");
    expect(rows[0].querySelector(".nk-versions__origin").textContent).toBe("AI-derived");
    expect(rows[1].querySelector(".nk-versions__origin").textContent).toBe("Human-corrected");
    expect(rows[0].querySelector(".nk-versions__when").textContent).toBe(
      "1 Sep 2026, 23:31:20 +05:30"
    );
    for (const r of rows) {
      expect(r.querySelector(".nk-versions__signed").textContent).toBe("✓ signed");
    }
  });

  it("marks the selected version", () => {
    const rows = [...el.querySelectorAll(".nk-versions__row")];
    expect(rows[0].getAttribute("aria-pressed")).toBe("false");
    expect(rows[1].getAttribute("aria-pressed")).toBe("true");
  });

  it("clicking a row reports that version number", () => {
    const onSelect = vi.fn();
    const e = renderVersionHistory(VERSIONED.versions, { selected: 2, onSelect });
    e.querySelector('[data-version="1"]').click();
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});

describe("createReviewController", () => {
  it("calls the revise seam once with the corrected data and note, then onRevised", async () => {
    const updated = { ...VERSIONED };
    const reviseApi = { revise: vi.fn(async () => updated) };
    const onRevised = vi.fn();
    const ctrl = createReviewController({ reviseApi, onRevised });

    ctrl.open({ evidenceId: "NK-0007", data: v1() });
    const form = ctrl.element.querySelector(".nk-review");
    const contact = [...form.querySelectorAll(".nk-review__field")]
      .find((f) => f.querySelector(".nk-review__label").textContent === "Contact")
      .querySelector("input");
    contact.value = "Mr. A. Bakshi";
    const reason = [...form.querySelectorAll(".nk-review__field")]
      .find((f) => f.querySelector(".nk-review__label").textContent.startsWith("Reason"))
      .querySelector("input");
    reason.value = "Fixed the misread name";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(reviseApi.revise).toHaveBeenCalledTimes(1);
    const [id, data, opts] = reviseApi.revise.mock.calls[0];
    expect(id).toBe("NK-0007");
    expect(data.contact_name).toBe("Mr. A. Bakshi");
    expect(opts).toEqual({ note: "Fixed the misread name" });
    expect(onRevised).toHaveBeenCalledWith("NK-0007", updated);
    expect(ctrl.element.hidden).toBe(true); // closed on success
  });

  it("on a revise failure: no onRevised, editor stays open, error surfaced", async () => {
    const reviseApi = { revise: vi.fn(async () => Promise.reject(new Error("worker offline"))) };
    const onRevised = vi.fn();
    const ctrl = createReviewController({ reviseApi, onRevised });

    ctrl.open({ evidenceId: "NK-0007", data: v1() });
    ctrl.element
      .querySelector(".nk-review")
      .dispatchEvent(new Event("submit", { cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onRevised).not.toHaveBeenCalled();
    expect(ctrl.element.hidden).toBe(false);
    expect(ctrl.element.querySelector(".nk-review__error").textContent).toMatch(
      /correction was not saved: worker offline/i
    );
    expect(ctrl.element.querySelector(".nk-review")).not.toBeNull();
  });

  it("Cancel closes without touching the seam", () => {
    const reviseApi = { revise: vi.fn() };
    const ctrl = createReviewController({ reviseApi });
    ctrl.open({ evidenceId: "NK-0007", data: v1() });
    ctrl.element.querySelector(".nk-review__cancel").click();
    expect(ctrl.element.hidden).toBe(true);
    expect(reviseApi.revise).not.toHaveBeenCalled();
  });
});

describe("detail panel — version-aware", () => {
  let seq = 0;
  beforeEach(() => {
    seq = 0;
    URL.createObjectURL = vi.fn(() => `blob:mock-${++seq}`);
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete URL.createObjectURL;
    delete URL.revokeObjectURL;
  });

  function api() {
    return {
      get: vi.fn(async () => ({
        manifest: VERSIONED.manifest,
        created_at: VERSIONED.created_at,
        platform_label: VERSIONED.platform_label,
        last_verification: null,
        versions: VERSIONED.versions,
        screenshotDataUrl: PNG_DATA_URL
      }))
    };
  }

  it("defaults to the latest version and lists the history", async () => {
    const panel = createDetailPanel({ detailApi: api() });
    await panel.show("NK-0007");
    const el = panel.element;

    expect(el.querySelector(".nk-detail__id").textContent).toContain("v2 (latest)");
    expect(el.querySelectorAll(".nk-versions__row")).toHaveLength(2);
    // v2's corrected contact is shown
    expect(el.querySelector(".nk-derived").textContent).toContain("Mr. A. Bakshi");
    expect(el.querySelector(".nk-derived").textContent).not.toContain("Mr. ABC B");
  });

  it("switching to v1 shows the original AI text; the screenshot hash is identical", async () => {
    const panel = createDetailPanel({ detailApi: api() });
    await panel.show("NK-0007");
    const el = panel.element;

    const hashOf = () =>
      [...el.querySelectorAll(".nk-integrity__row")]
        .find((r) => r.querySelector(".nk-integrity__key")?.textContent === "Screenshot hash")
        .querySelector(".nk-integrity__val").title;
    const v2hash = hashOf();

    el.querySelector('.nk-versions__row[data-version="1"]').click();

    expect(el.querySelector(".nk-detail__id").textContent).toContain("v1");
    expect(el.querySelector(".nk-derived").textContent).toContain("Mr. ABC B");
    expect(el.querySelector(".nk-derived").textContent).toContain("I know where you Iive");
    expect(hashOf()).toBe(v2hash); // screenshot hash unchanged across versions
    // no extra object URL was created for the version switch
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("[Edit metadata] on the latest version calls onEditMetadata with that version's data", async () => {
    const onEditMetadata = vi.fn();
    const panel = createDetailPanel({ detailApi: api(), onEditMetadata });
    await panel.show("NK-0007");

    panel.element.querySelector(".nk-derived__edit").click();
    expect(onEditMetadata).toHaveBeenCalledTimes(1);
    const [id, data] = onEditMetadata.mock.calls[0];
    expect(id).toBe("NK-0007");
    expect(data.contact_name).toBe("Mr. A. Bakshi");
  });

  it("an older version has no [Edit metadata] control", async () => {
    const panel = createDetailPanel({ detailApi: api(), onEditMetadata: vi.fn() });
    await panel.show("NK-0007");
    panel.element.querySelector('.nk-versions__row[data-version="1"]').click();
    expect(panel.element.querySelector(".nk-derived__edit")).toBeNull();
  });

  it("a single-version record (no versions[]) renders with no history section", async () => {
    const single = {
      get: async () => ({
        manifest: loadUiFixture("record.sample").manifest,
        created_at: "2026-09-01T23:31:14+05:30",
        platform_label: "WhatsApp",
        last_verification: null,
        screenshotDataUrl: PNG_DATA_URL
      })
    };
    const panel = createDetailPanel({ detailApi: single });
    await panel.show("NK-0001");
    expect(panel.element.querySelector(".nk-versions")).toBeNull();
    expect(panel.element.querySelector(".nk-detail__id").textContent).toBe("NK-0001");
  });
});
