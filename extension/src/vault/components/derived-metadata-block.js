/**
 * EVOCK — AI-derived metadata block (Role C, step 04 / C3, spec §25.1).
 *
 * HONESTY RULE 1: this block must never look like ground truth sitting beside the
 * screenshot. It renders in a tinted panel (.nk-derived) with a label that is
 * always on screen ("AI-derived metadata"), an info affordance, and a plain-text
 * note that a vision model can misread names, timestamps and small text. When
 * extraction failed there is no metadata — say so calmly, as a missing detail,
 * not as a failed capture (Role C.md §5).
 */

import { directionLabel } from "../../shared/message-direction.js";

const MISREAD_NOTE =
  "A vision model produced the values below. It can misread names, timestamps, " +
  "message text and small or partly hidden text — check each one against the " +
  "screenshot above.";

/**
 * @param {import("../../shared/types.js").ManifestAiDerivedMetadata|null} aiDerivedMetadata
 *   i.e. `manifest.ai_derived_metadata`
 * @param {{ onEdit?: () => void }} [opts] when `onEdit` is given an
 *   `[Edit metadata]` control is shown (Role C step 06). Only wire it for the
 *   LATEST version — corrections build on the latest, never on an old one.
 * @returns {HTMLElement} `<section class="nk-derived">`
 */
export function renderDerivedMetadataBlock(aiDerivedMetadata, { onEdit } = {}) {
  const root = document.createElement("section");
  root.className = "nk-derived";

  const label = document.createElement("span");
  label.className = "nk-derived__label";
  const info = document.createElement("span");
  info.className = "nk-derived__info";
  info.textContent = "i";
  info.setAttribute("role", "img");
  info.setAttribute("aria-label", "About AI-derived metadata");
  info.title = MISREAD_NOTE;
  label.append(document.createTextNode("AI-derived metadata"), info);
  root.append(label);

  if (onEdit) {
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "nk-derived__edit";
    edit.textContent = "Edit metadata";
    edit.addEventListener("click", () => onEdit());
    root.append(edit);
  }

  const failed =
    !aiDerivedMetadata || aiDerivedMetadata.status === "failed" || aiDerivedMetadata.data == null;

  if (failed) {
    const msg = document.createElement("p");
    msg.className = "nk-derived__unavailable";
    msg.textContent =
      "AI extraction unavailable — no derived metadata for this record. " +
      "The screenshot, hashes, signature and encryption below are unaffected.";
    root.append(msg);
    return root;
  }

  const note = document.createElement("p");
  note.className = "nk-derived__note";
  note.textContent = MISREAD_NOTE;
  root.append(note);

  const data = aiDerivedMetadata.data;
  const kv = document.createElement("div");
  kv.className = "nk-kv";

  addRow(kv, "Platform", data.platform || "Unknown", !data.platform);
  addRow(kv, "Contact", data.contact_name || "unknown account", !data.contact_name);

  const messages = Array.isArray(data.messages) ? data.messages : [];
  if (messages.length === 0) {
    addRow(kv, "Messages", "No message text extracted", true);
  } else {
    const key = document.createElement("span");
    key.className = "nk-kv__key";
    key.textContent = "Messages";
    const val = document.createElement("div");
    val.className = "nk-kv__val";
    for (const m of messages) {
      const line = document.createElement("div");
      line.className = "nk-msg";

      const head = document.createElement("div");
      head.className = "nk-msg__head";
      const dir = document.createElement("span");
      dir.className = "nk-msg__dir";
      dir.textContent = directionLabel(m);
      head.append(dir);
      const who = m && typeof m.sender === "string" ? m.sender.trim() : "";
      if (who) {
        const name = document.createElement("span");
        name.className = "nk-msg__who";
        name.textContent = who;
        head.append(name);
      }

      const body = document.createElement("div");
      const text = m && typeof m.text === "string" ? m.text : "";
      body.textContent = text ? `“${text}”` : "(no text)";
      if (!text) body.className = "nk-kv__val--muted";

      line.append(head, body);
      val.append(line);
    }
    kv.append(key, val);
  }

  addRow(kv, "Visible time", data.visible_time || "Not visible", !data.visible_time);
  addRow(kv, "Date", data.date || "Not visible", !data.date);

  root.append(kv);
  return root;
}

/**
 * @param {HTMLElement} kv
 * @param {string} keyText
 * @param {string} valText
 * @param {boolean} [muted] render the value italic/muted (a fallback, not real data)
 */
function addRow(kv, keyText, valText, muted = false) {
  const key = document.createElement("span");
  key.className = "nk-kv__key";
  key.textContent = keyText;
  const val = document.createElement("span");
  val.className = muted ? "nk-kv__val nk-kv__val--muted" : "nk-kv__val";
  val.textContent = valText;
  kv.append(key, val);
}
