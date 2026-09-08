/**
 * EVOCK — human review / edit of AI metadata (Role C, step 06 / C4, spec §26.4).
 *
 * The user corrects what the vision model misread. The rule that makes this
 * defensible: **an edit never overwrites a signed record.** The editor only
 * collects the corrected `ai_derived_metadata.data`; Role B's evidence core
 * re-canonicalizes, re-hashes, re-signs and appends a new entry to `versions[]`.
 * Role C signs nothing and never writes the vault.
 *
 *  - `renderVersionHistory(versions, {...})` — the v1 / v2 list, each with its
 *    origin (AI-derived / Human-corrected), signed time and "✓ signed" status.
 *  - `renderReviewEditor(data, {...})` — the correction form.
 *  - `createReviewController({ reviseApi, onRevised })` — glue: open → edit →
 *    reviseApi.revise() → on success onRevised(); on failure the versions are
 *    untouched and the UI says the correction was not saved.
 */

import { envelope, MSG } from "../../shared/messages.js";
import { directionLabel } from "../../shared/message-direction.js";
import { formatDeviceTime } from "./detail-panel.js";

const ORIGIN_LABEL = { ai: "AI-derived", human: "Human-corrected" };

const CORRECTION_NOTE =
  "A correction is itself a signed, evidenced event — it is added as a new " +
  "version. The original AI-derived version is kept and stays verifiable.";

/** Production seam: REVISE_METADATA -> updated StoredEvidenceRecord. */
export const chromeReviseApi = {
  /**
   * @param {string} evidence_id
   * @param {object} data corrected `ai_derived_metadata.data`
   * @param {{ note?: string|null }} [opts]
   * @returns {Promise<object>} the updated record (with the appended version)
   */
  async revise(evidence_id, data, { note = null } = {}) {
    const res = await chrome.runtime.sendMessage(
      envelope(MSG.REVISE_METADATA, { evidence_id, data, note })
    );
    if (!res || !res.ok) {
      throw new Error((res && res.error) || "Could not save the correction.");
    }
    return res.record;
  }
};

/**
 * @param {Array<{ version: number, origin: string, created_at: string, manifest?: object }>} versions
 * @param {{ selected?: number, onSelect?: (version: number) => void }} [opts]
 * @returns {HTMLElement} `<div class="nk-versions">`
 */
export function renderVersionHistory(versions, { selected, onSelect } = {}) {
  const root = document.createElement("div");
  root.className = "nk-versions";
  const list = Array.isArray(versions) ? versions : [];

  for (const v of list) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "nk-versions__row";
    row.dataset.version = String(v.version);
    const isSelected = v.version === selected;
    row.setAttribute("aria-pressed", String(isSelected));
    if (isSelected) row.classList.add("nk-versions__row--selected");

    const tag = document.createElement("span");
    tag.className = "nk-versions__tag";
    tag.textContent = `v${v.version}`;

    const origin = document.createElement("span");
    origin.className = "nk-versions__origin";
    origin.textContent = ORIGIN_LABEL[v.origin] || v.origin || "Unknown origin";

    const when = document.createElement("span");
    when.className = "nk-versions__when";
    when.textContent = v.created_at ? formatDeviceTime(v.created_at) : "—";

    const signed = document.createElement("span");
    const isSigned = Boolean(v.manifest?.signature?.signature);
    signed.className = `nk-versions__signed nk-versions__signed--${isSigned ? "ok" : "no"}`;
    signed.textContent = isSigned ? "✓ signed" : "not signed";

    row.append(tag, origin, when, signed);
    row.addEventListener("click", () => onSelect?.(v.version));
    root.append(row);
  }

  return root;
}

/**
 * @param {object|null} data current `ai_derived_metadata.data` (null → blank form)
 * @param {{ onSave?: (data: object, opts: { note: string|null }) => void, onCancel?: () => void }} [opts]
 * @returns {HTMLElement} `<form class="nk-review">`
 */
export function renderReviewEditor(data, { onSave, onCancel } = {}) {
  const d = normalizeData(data);
  const form = document.createElement("form");
  form.className = "nk-review";
  form.noValidate = true;

  const heading = document.createElement("p");
  heading.className = "nk-review__heading";
  heading.textContent = "Correct what the model misread";
  const note = document.createElement("p");
  note.className = "nk-review__note";
  note.textContent = CORRECTION_NOTE;
  form.append(heading, note);

  const platform = textField(form, "Platform", d.platform);
  const contact = textField(form, "Contact", d.contact_name);

  const messagesWrap = document.createElement("div");
  messagesWrap.className = "nk-review__messages";
  const msgLegend = document.createElement("p");
  msgLegend.className = "nk-review__legend";
  msgLegend.textContent = "Messages";
  messagesWrap.append(msgLegend);
  /** @type {Array<() => object>} */
  const messageReaders = [];
  for (const m of d.messages) messagesWrap.append(messageRow(m, messageReaders));
  form.append(messagesWrap);

  const visibleTime = textField(form, "Visible time", d.visible_time);
  const date = textField(form, "Date", d.date);
  const reason = textField(form, "Reason for this correction (optional)", "");

  const actions = document.createElement("div");
  actions.className = "nk-review__actions";
  const save = document.createElement("button");
  save.type = "submit";
  save.className = "nk-review__save";
  save.textContent = "Save corrected version";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "nk-review__cancel";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => onCancel?.());
  actions.append(save, cancel);
  form.append(actions);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    /** @type {object} */
    const next = {
      platform: nullIfBlank(platform.value),
      contact_name: nullIfBlank(contact.value),
      messages: messageReaders.map((read) => read()),
      visible_time: nullIfBlank(visibleTime.value),
      date: nullIfBlank(date.value)
    };
    onSave?.(next, { note: nullIfBlank(reason.value) });
  });

  return form;
}

/**
 * @param {{ reviseApi?: { revise: Function }, onRevised?: (id: string, record: object) => void }} [opts]
 * @returns {{ element: HTMLElement, open: (o: { evidenceId: string, data: object|null }) => void, close: () => void }}
 */
export function createReviewController({ reviseApi = chromeReviseApi, onRevised } = {}) {
  const element = document.createElement("div");
  element.className = "nk-review-host";
  element.hidden = true;

  let busy = false;

  function close() {
    element.replaceChildren();
    element.hidden = true;
    busy = false;
  }

  function open({ evidenceId, data }) {
    busy = false;
    element.hidden = false;
    element.replaceChildren(
      renderReviewEditor(data, {
        onCancel: close,
        onSave: async (nextData, { note }) => {
          if (busy) return;
          busy = true;
          clearError();
          try {
            const record = await reviseApi.revise(evidenceId, nextData, { note });
            onRevised?.(evidenceId, record);
            close();
          } catch (err) {
            busy = false;
            showError(err?.message || String(err));
          }
        }
      })
    );
  }

  function clearError() {
    element.querySelector(".nk-review__error")?.remove();
  }

  function showError(message) {
    clearError();
    const box = document.createElement("p");
    box.className = "nk-review__error";
    box.textContent = `The correction was not saved: ${message}`;
    element.querySelector(".nk-review")?.prepend(box);
  }

  return { element, open, close };
}

// --- helpers --------------------------------------------------------------

function normalizeData(data) {
  const d = data && typeof data === "object" ? data : {};
  return {
    platform: d.platform ?? "",
    contact_name: d.contact_name ?? "",
    messages: Array.isArray(d.messages) ? d.messages : [],
    visible_time: d.visible_time ?? "",
    date: d.date ?? ""
  };
}

function nullIfBlank(v) {
  const s = typeof v === "string" ? v.trim() : v;
  return s === "" || s == null ? null : s;
}

function textField(parent, labelText, value) {
  const wrap = document.createElement("label");
  wrap.className = "nk-review__field";
  const span = document.createElement("span");
  span.className = "nk-review__label";
  span.textContent = labelText;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "nk-review__input";
  input.value = value ?? "";
  wrap.append(span, input);
  parent.append(wrap);
  return input;
}

function messageRow(message, readers) {
  const row = document.createElement("div");
  row.className = "nk-review__message";

  const type = message?.type ?? null;

  // Direction is derived from `type`, not edited here — shown read-only so the
  // corrected row still reads as "<direction> <name>: <text>", same as every
  // other surface.
  const dir = document.createElement("span");
  dir.className = "nk-review__msg-dir";
  dir.textContent = directionLabel(message);
  dir.setAttribute("aria-label", "Message direction");

  const sender = document.createElement("input");
  sender.type = "text";
  sender.className = "nk-review__input nk-review__msg-sender";
  sender.value = message?.sender ?? "";
  sender.setAttribute("aria-label", "Message sender");

  const text = document.createElement("input");
  text.type = "text";
  text.className = "nk-review__input nk-review__msg-text";
  text.value = message?.text ?? "";
  text.setAttribute("aria-label", "Message text");

  const time = document.createElement("input");
  time.type = "text";
  time.className = "nk-review__input nk-review__msg-time";
  time.value = message?.visible_timestamp ?? "";
  time.setAttribute("aria-label", "Message visible timestamp");

  row.append(dir, sender, text, time);

  readers.push(() => ({
    sender: nullIfBlank(sender.value),
    text: nullIfBlank(text.value),
    visible_timestamp: nullIfBlank(time.value),
    type
  }));

  return row;
}
