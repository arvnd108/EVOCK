/**
 * EVOCK — integrity block (Role C, step 04 / C3, Task 2 + Task 4).
 *
 * The three SHA-256 hashes (each with a copy button), signature status,
 * trusted-timestamp status and encryption status.
 *
 * HONESTY RULE 2 (spec §25.11): "Device time" and "Trusted timestamp" are never
 * the same row. Device time is rendered by the detail panel's capture-context
 * section; this block renders the trusted-timestamp status on its own line, and
 * when it is `not_configured` it says "Not configured" in plain text — the row is
 * never hidden and never folded into device time.
 *
 * No hash value is ever written to a URL or passed to `console.*`.
 */

const TS_STATUS_TEXT = {
  not_configured: "Not configured",
  pending: "Pending",
  ok: "Recorded",
  failed: "Failed"
};

/**
 * "ECDSA-P256-SHA256" -> "ECDSA P-256"; anything else passes through.
 * @param {string} algorithm
 */
function signatureLabel(algorithm) {
  if (algorithm === "ECDSA-P256-SHA256") return "ECDSA P-256";
  return algorithm || "unknown";
}

/**
 * @param {import("../../shared/types.js").EvidenceManifest} manifest
 * @param {{ onCopy?: (label: string, value: string) => void }} [opts]
 *   onCopy overrides the default `navigator.clipboard.writeText`; tests inject it.
 * @returns {HTMLElement} `<div class="nk-integrity">`
 */
export function renderIntegrityBlock(manifest, { onCopy } = {}) {
  const root = document.createElement("div");
  root.className = "nk-integrity";

  const integrity = manifest.integrity || {};
  const signature = manifest.signature || {};
  const timestamp = manifest.timestamp || {};
  const encryption = (manifest.visual_artifact && manifest.visual_artifact.encryption) || {};

  hashRow(root, "Screenshot hash", integrity.screenshot_hash, onCopy);
  hashRow(root, "Metadata hash", integrity.metadata_hash, onCopy);
  hashRow(root, "Manifest hash", integrity.manifest_hash, onCopy);

  const sigOk = typeof signature.signature === "string" && signature.signature.length > 0;
  plainRow(root, "Signature", `${sigOk ? "✓ " : ""}${signatureLabel(signature.algorithm)}`);

  const tsStatus = timestamp.trusted_timestamp_status || "not_configured";
  plainRow(root, "Trusted timestamp", TS_STATUS_TEXT[tsStatus] || tsStatus);

  const encOk = encryption.algorithm === "AES-GCM";
  plainRow(
    root,
    "Encryption",
    encOk ? `✓ AES-GCM ${encryption.key_length || 256}` : encryption.algorithm || "none"
  );

  return root;
}

function truncateHash(hex) {
  if (typeof hex !== "string" || hex.length === 0) return "—";
  return hex.length > 12 ? `${hex.slice(0, 10)}…` : hex;
}

async function defaultCopy(value) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
  }
}

function hashRow(root, keyText, hexValue, onCopy) {
  const row = document.createElement("div");
  row.className = "nk-integrity__row";

  const key = document.createElement("span");
  key.className = "nk-integrity__key";
  key.textContent = keyText;

  const val = document.createElement("span");
  val.className = "nk-integrity__val";
  val.textContent = truncateHash(hexValue);
  if (typeof hexValue === "string" && hexValue) val.title = hexValue;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "nk-copy";
  btn.textContent = "Copy";
  btn.disabled = !hexValue;
  btn.setAttribute("aria-label", `Copy ${keyText}`);
  btn.addEventListener("click", () => {
    // Never log the value; hand it straight to the clipboard seam.
    if (onCopy) onCopy(keyText, hexValue);
    else void defaultCopy(hexValue);
    btn.textContent = "Copied";
    setTimeout(() => {
      btn.textContent = "Copy";
    }, 1200);
  });

  row.append(key, val, btn);
  root.append(row);
}

function plainRow(root, keyText, valText) {
  const row = document.createElement("div");
  row.className = "nk-integrity__row";
  const key = document.createElement("span");
  key.className = "nk-integrity__key";
  key.textContent = keyText;
  const val = document.createElement("span");
  val.className = "nk-integrity__val";
  val.textContent = valText;
  row.append(key, val);
  root.append(row);
}
