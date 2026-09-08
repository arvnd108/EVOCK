/**
 * EVOCK — verification panel (Role C, step 05 / C5, spec §18).
 *
 * Renders a `VerificationResult` from Role B's `verifyEvidence(id)` — the three
 * outcomes (VERIFIED / MODIFIED / ERROR) as genuinely distinct states, the
 * per-field ✓/❌ row, and on a MODIFIED result the recorded-vs-current hash pair
 * side by side (spec §18: the cryptographic argument in two lines).
 *
 * This module does NOT compute or canonicalize anything — it reads results.
 *  - recorded hash  ← `manifest.integrity.{screenshot,metadata,manifest}_hash`
 *  - current hash   ← `result.current_integrity.{...}_hash` (supplied by Role B's
 *                     verifier; mirrors `manifest.integrity`). If a result ever
 *                     lacks it the current slot shows "not reported", never a
 *                     locally-derived value.
 *  - `details[]`     ← rendered VERBATIM (they are the frozen VERIFY_DETAILS).
 */

import { envelope, MSG } from "../../shared/messages.js";
import { formatDay, formatDeviceTime } from "./record-card.js";

export const HONEST_FOOTER =
  "Verification shows that the stored record has not changed since preservation. " +
  "It does not establish who sent a message or whether the conversation is truthful.";

/** Production seam: VERIFY_EVIDENCE -> VerificationResult. */
export const chromeVerifyApi = {
  /**
   * @param {string} evidence_id
   * @returns {Promise<import("../../shared/types.js").VerificationResult>}
   */
  async verify(evidence_id) {
    const res = await chrome.runtime.sendMessage(envelope(MSG.VERIFY_EVIDENCE, { evidence_id }));
    if (!res || !res.ok) {
      throw new Error((res && res.error) || "Verification failed.");
    }
    return res.result;
  }
};

const HASH_FIELDS = [
  ["screenshot", "screenshot_hash_ok", "screenshot", "screenshot"],
  ["metadata", "metadata_hash_ok", "metadata", "AI-derived metadata"],
  ["manifest", "manifest_hash_ok", "manifest", "signed manifest"]
];

/**
 * @param {import("../../shared/types.js").VerificationResult} result
 * @param {{ manifest?: import("../../shared/types.js").EvidenceManifest }} [opts]
 * @returns {HTMLElement}
 */
export function renderVerifyPanel(result, { manifest } = {}) {
  const status = result?.status;
  const root = document.createElement("section");
  root.className = `nk-verify nk-verify--${String(status || "unknown").toLowerCase()}`;
  root.setAttribute("role", "status");

  if (status === "VERIFIED") {
    root.append(
      banner("✓", "INTEGRITY VERIFIED"),
      checksRow(result),
      line(
        "nk-verify__when",
        result.verified_at ? `Verified ${formatDeviceTime(result.verified_at)}` : "Verified"
      ),
      footer()
    );
    return root;
  }

  if (status === "MODIFIED") {
    root.append(banner("❌", "MODIFICATION DETECTED"));

    const primary = HASH_FIELDS.find(([, okKey]) => result[okKey] === false);
    if (primary) {
      const [key, , , label] = primary;
      const recorded = manifest?.integrity?.[`${key}_hash`] ?? null;
      const current = result.current_integrity?.[`${key}_hash`] ?? null;
      root.append(hashPair(recorded, current));
      const createdOn = manifest?.capture?.device_captured_at;
      root.append(
        line(
          "nk-verify__explain",
          `The ${label} does not match the record` +
            (createdOn ? ` created on ${formatDay(createdOn)}.` : ".")
        )
      );
    } else if (result.signature_ok === false) {
      root.append(line("nk-verify__explain", "The digital signature does not verify."));
    }

    root.append(checksRow(result), detailList(result.details), footer());
    return root;
  }

  // ERROR — neutral, never the red MODIFIED treatment.
  root.append(
    banner("⚠", "Verification could not complete"),
    line(
      "nk-verify__explain",
      "A check could not be evaluated, so the record was neither confirmed nor shown to be changed."
    ),
    checksRow(result),
    detailList(result?.details),
    footer()
  );
  return root;
}

function banner(symbol, text) {
  const el = document.createElement("div");
  el.className = "nk-verify__banner";
  const sym = document.createElement("span");
  sym.className = "nk-verify__banner-symbol";
  sym.textContent = symbol;
  const txt = document.createElement("span");
  txt.className = "nk-verify__banner-text";
  txt.textContent = text;
  el.append(sym, txt);
  return el;
}

function checksRow(result) {
  const row = document.createElement("div");
  row.className = "nk-verify__checks";
  const fields = [
    ["Screenshot", result?.screenshot_hash_ok],
    ["Metadata", result?.metadata_hash_ok],
    ["Manifest", result?.manifest_hash_ok],
    ["Signature", result?.signature_ok]
  ];
  for (const [label, ok] of fields) {
    const cell = document.createElement("span");
    cell.className = `nk-verify__check nk-verify__check--${ok ? "ok" : "bad"}`;
    cell.dataset.ok = String(Boolean(ok));
    cell.textContent = `${label} ${ok ? "✓" : "❌"}`;
    row.append(cell);
  }
  return row;
}

function hashPair(recorded, current) {
  const wrap = document.createElement("div");
  wrap.className = "nk-verify__hashes";
  wrap.append(hashLine("RECORDED HASH", recorded), hashLine("CURRENT HASH", current));
  return wrap;
}

function hashLine(labelText, value) {
  const row = document.createElement("div");
  row.className = "nk-verify__hash";
  const label = document.createElement("span");
  label.className = "nk-verify__hash-label";
  label.textContent = labelText;
  const val = document.createElement("span");
  val.className = "nk-verify__hash-val";
  if (typeof value === "string" && value) {
    val.textContent = value;
    val.title = value;
  } else {
    val.textContent = "not reported by the verifier";
    val.classList.add("nk-verify__hash-val--missing");
  }
  row.append(label, val);
  return row;
}

function detailList(details) {
  const list = document.createElement("ul");
  list.className = "nk-verify__details";
  for (const d of Array.isArray(details) ? details : []) {
    const li = document.createElement("li");
    li.textContent = d; // verbatim — frozen VERIFY_DETAILS string
    list.append(li);
  }
  return list;
}

function line(cls, text) {
  const p = document.createElement("p");
  p.className = cls;
  p.textContent = text;
  return p;
}

function footer() {
  const el = document.createElement("p");
  el.className = "nk-verify__footer";
  el.textContent = HONEST_FOOTER;
  return el;
}

/**
 * Interactive wrapper: runs a verification and renders the result.
 *
 * @param {{
 *   verifyApi?: { verify: (id: string) => Promise<object> },
 *   onResult?: (id: string, result: object) => void
 * }} [opts]
 * @returns {{ element: HTMLElement, run: (id: string, o?: object) => Promise<object|undefined>, close: () => void }}
 */
export function createVerifyPanel({ verifyApi = chromeVerifyApi, onResult } = {}) {
  const element = document.createElement("div");
  element.className = "nk-verify-host";
  element.hidden = true;

  async function run(evidenceId, { manifest } = {}) {
    element.hidden = false;
    element.replaceChildren(line("nk-verify__busy", `Verifying ${evidenceId}…`));

    let result;
    try {
      result = await verifyApi.verify(evidenceId);
    } catch (err) {
      element.replaceChildren(
        line("nk-verify__run-error", `Could not run verification: ${err?.message || err}`)
      );
      return undefined;
    }

    element.replaceChildren(renderVerifyPanel(result, { manifest }));
    onResult?.(evidenceId, result);
    return result;
  }

  function close() {
    element.replaceChildren();
    element.hidden = true;
  }

  return { element, run, close };
}
