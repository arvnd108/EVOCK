/**
 * EVOCK — machine-readable evidence package (Role C, step 07 / C6, spec §19).
 *
 * A JSZip archive an investigator with Python and no EVOCK install can verify
 * from README.txt alone:
 *
 *   NK-0003/
 *   ├── manifest.json        EvidenceManifest v1.0, canonical + reduced —
 *   │                        byte-identical to what the vault hashed for
 *   │                        manifest_hash (see reduceManifestForHashing).
 *   ├── screenshot.enc       AES-GCM ciphertext, raw bytes. Key NOT included.
 *   ├── signature.sig        base64 ECDSA P-256 signature over manifest_hash.
 *   ├── public-key.jwk       so the signature checks without our vault.
 *   ├── verification.json    the last VerificationResult (or null).
 *   └── README.txt           the exact hashing recipe, spelled out.
 *
 * The manifest is NOT re-serialised by hand: it goes through Role B's
 * `reduceManifestForHashing` + `canonicalize`, the same path `buildManifest`
 * used, so the bytes match and a third party's `sha256(manifest.json)` equals
 * `integrity.manifest_hash`.
 *
 * LIBRARY SEAM: `JSZip` is injected (Vitest passes the npm package; the vault
 * page passes `globalThis.JSZip` from the vendored classic script).
 */

import { canonicalize } from "../evidence/canonicalize.js";
import { reduceManifestForHashing } from "../evidence/index.js";
import { buildVerifyReadme } from "./verify-readme.txt.js";

/**
 * @param {string} evidence_id
 * @returns {string} e.g. "EVOCK-NK-0003-package.zip"
 */
export function packageZipFilename(evidence_id) {
  return `EVOCK-${evidence_id || "NK-XXXX"}-package.zip`;
}

/**
 * @param {{
 *   record: import("../shared/types.js").StoredEvidenceRecord,
 *   verification?: import("../shared/types.js").VerificationResult | null
 * }} input
 * @param {{ JSZip?: Function }} [opts]
 * @returns {Promise<Uint8Array>} the .zip bytes
 */
export async function buildPackageZip({ record, verification = null }, opts = {}) {
  const JsZip = resolveJSZip(opts.JSZip);
  if (typeof JsZip !== "function") {
    throw new Error(
      "buildPackageZip: no JSZip available (inject { JSZip } or load the vendored script)"
    );
  }
  if (!record || typeof record !== "object" || !record.manifest) {
    throw new TypeError("buildPackageZip: a StoredEvidenceRecord with a manifest is required");
  }

  const manifest = record.manifest;
  const evidenceId = record.evidence_id || manifest.evidence_id || "NK-XXXX";
  const signature = manifest.signature || {};

  // The exact preimage of integrity.manifest_hash — reduced, then canonicalised
  // through the same functions the evidence core used. Written with no trailing
  // newline so `sha256(manifest.json)` reproduces the stored hash.
  const canonicalManifest = canonicalize(reduceManifestForHashing(manifest));

  const zip = new JsZip();
  const dir = zip.folder(evidenceId);
  dir.file("manifest.json", canonicalManifest);
  dir.file("screenshot.enc", toBytes(record.screenshot_ciphertext));
  dir.file("signature.sig", typeof signature.signature === "string" ? signature.signature : "");
  dir.file("public-key.jwk", JSON.stringify(signature.public_key_jwk ?? null, null, 2) + "\n");
  dir.file("verification.json", JSON.stringify(verification ?? null, null, 2) + "\n");
  dir.file("README.txt", buildVerifyReadme({ evidence_id: evidenceId }));

  const out = await zip.generateAsync({ type: "uint8array" });
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}

/**
 * Coerce a stored ciphertext field to raw bytes. A real IndexedDB record holds
 * an ArrayBuffer; a JSON fixture holds base64 text; a caller may already have a
 * Uint8Array.
 * @param {ArrayBuffer|ArrayBufferView|string|null|undefined} value
 * @returns {Uint8Array}
 */
export function toBytes(value) {
  if (value == null) return new Uint8Array(0);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof value === "string") {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  throw new TypeError("toBytes: unsupported ciphertext type");
}

/**
 * @param {Function} [injected]
 * @returns {Function|undefined}
 */
function resolveJSZip(injected) {
  if (typeof injected === "function") return injected;
  const g = typeof globalThis !== "undefined" ? globalThis : {};
  return typeof g.JSZip === "function" ? g.JSZip : undefined;
}
