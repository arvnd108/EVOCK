/**
 * EVOCK — AI-derived metadata block (Role C, step 04 / C3, spec §25.1).
 *
 * The block renders in a tinted panel (.nk-derived) so it never looks like
 * ground truth sitting beside the screenshot. When extraction failed there is no
 * metadata — say so calmly, as a missing detail, not as a failed capture
 * (Role C.md §5).
 */

import { directionLabel } from "../../shared/message-direction.js";

/**
 * @param {import("../../shared/types.js").ManifestAiDerivedMetadata|null} aiDerivedMetadata
 *   i.e. `manifest.ai_derived_metadata`
 * @returns {HTMLElement} `<section class="nk-derived">`
 */
export function renderDerivedMetadataBlock(aiDerivedMetadata) {
  const root = document.createElement("section");
  root.className = "nk-derived";

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
      const ts = m && typeof m.visible_timestamp === "string" ? m.visible_timestamp.trim() : "";
      if (ts) {
        const time = document.createElement("span");
        time.className = "nk-msg__ts";
        time.textContent = ts;
        head.append(time);
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
