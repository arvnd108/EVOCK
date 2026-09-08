/**
 * EVOCK — the `README.txt` that ships inside every exported evidence package
 * (Role C, step 07 / C6).
 *
 * The package is only genuinely useful if someone with stock tools and no EVOCK
 * install can reproduce the hashes and check the signature from this file alone.
 * So the exact hashing order from Plan/Building Plan.md §5.3 is written out here
 * verbatim (`HASHING_RECIPE`), followed by the precise byte-level details the
 * one-liners leave implicit, and a short worked example.
 *
 * COPY DISCIPLINE (spec §36 — audited in step 08): no "court-admissible", no
 * "proves", no "everything is local", no "recovers deleted messages", no
 * "identifies the sender". Every limitation is stated as something the package
 * *cannot* do.
 */

/**
 * The four hashing lines exactly as Role C step 07 froze them, matching
 * Plan/Building Plan.md §5.3. Rendered verbatim into README.txt; a test asserts
 * the generated file contains each line unchanged.
 * @type {readonly string[]}
 */
export const HASHING_RECIPE = Object.freeze([
  "screenshot_hash = SHA-256( bytes of screenshot.enc DECRYPTED )   # AES-GCM, key not included",
  "metadata_hash   = SHA-256( canonical JSON of manifest.ai_derived_metadata )",
  "manifest_hash   = SHA-256( canonical JSON of manifest MINUS .integrity.manifest_hash AND .signature )",
  "signature       = ECDSA-P256-SHA256 over the bytes of manifest_hash, verified with public-key.jwk"
]);

/**
 * What the package cannot establish — drawn from spec §27 / §36. Kept as data so
 * the PDF report's Limitations page and this README stay in step.
 * @type {readonly string[]}
 */
export const CANNOT_ESTABLISH = Object.freeze([
  "the truthfulness of the underlying conversation;",
  "the real-world identity of an account owner;",
  "hidden platform-side or server-side records;",
  "sender IP information;",
  "server-side content that was deleted before it was ever captured;",
  "legal admissibility — whether a court will accept this evidence is not for any tool to determine."
]);

/**
 * Build the README.txt body for one exported package.
 *
 * @param {{ evidence_id?: string }} [args]
 * @returns {string} the file contents, ending in a newline
 */
export function buildVerifyReadme({ evidence_id = "NK-XXXX" } = {}) {
  const id = String(evidence_id || "NK-XXXX");
  const rule = "=".repeat(`EVOCK evidence package — ${id}`.length);

  return `EVOCK evidence package — ${id}
${rule}

This is a tamper-evident evidence package. It is designed to support reporting
and investigation of online abuse. It is not a forensic examination and it does
not decide any legal question.

Everything in this package was generated on the device that made the capture.
EVOCK did not upload the screenshot or the manifest anywhere.


CONTENTS
--------
  manifest.json      The evidence manifest in canonical JSON form: UTF-8, object
                     keys sorted lexicographically, no insignificant whitespace,
                     integers only (an RFC 8785 / JCS subset). These are the
                     exact bytes the vault hashed for manifest_hash — the
                     .signature block and .integrity.manifest_hash field are
                     already excluded, so you can hash this file as-is.
  screenshot.enc     The screenshot ciphertext (AES-GCM, 256-bit). The
                     decryption key is NOT in this package — see KEY HANDLING.
  signature.sig      The manifest signature, base64. Raw ECDSA P-256 r||s form
                     (IEEE P1363, 64 bytes decoded), not DER.
  public-key.jwk     The public key, so the signature can be checked without any
                     access to the EVOCK vault that produced this package.
  verification.json  The most recent integrity check recorded for this record.
                     It is null if the record was never re-verified after
                     preservation.
  README.txt         This file.


HOW TO VERIFY
-------------
All hashes are SHA-256 over UTF-8 bytes. "canonical JSON" is the form described
for manifest.json above.

${HASHING_RECIPE.map((l) => "  " + l).join("\n")}

Byte-level details the lines above leave implicit:

  * "canonical JSON of manifest.ai_derived_metadata" means: take that sub-object
    from manifest.json and re-serialise it with sorted keys, no spaces, UTF-8.
  * "the bytes of manifest_hash" means the 32 raw bytes of the SHA-256 digest
    (the 64-hex string, hex-decoded) — not the ASCII of the hex string.
  * The signature is computed as ECDSA over those 32 bytes with an inner
    SHA-256, i.e. verify with message = the 32 digest bytes and hash = SHA-256.


WORKED EXAMPLE (Python 3, package: cryptography)
-----------------------------------------------
  import json, hashlib
  from cryptography.hazmat.primitives import hashes
  from cryptography.hazmat.primitives.asymmetric import ec, utils

  manifest = json.load(open("manifest.json"))
  raw      = open("manifest.json", "rb").read()

  def canon(o):
      return json.dumps(o, sort_keys=True, separators=(",", ":"),
                        ensure_ascii=False).encode("utf-8")

  # metadata_hash
  assert hashlib.sha256(canon(manifest["ai_derived_metadata"])).hexdigest() \\
         == manifest["integrity"]["metadata_hash"]

  # manifest_hash (manifest.json is already the reduced canonical form)
  mh = hashlib.sha256(raw).hexdigest()
  assert mh == manifest["integrity"]["manifest_hash"]

  # signature over the 32 digest bytes
  jwk = json.load(open("public-key.jwk"))
  import base64
  b64u = lambda s: base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))
  pub  = ec.EllipticCurvePublicNumbers(
             int.from_bytes(b64u(jwk["x"]), "big"),
             int.from_bytes(b64u(jwk["y"]), "big"),
             ec.SECP256R1()).public_key()
  sig  = base64.b64decode(open("signature.sig").read())
  der  = utils.encode_dss_signature(
             int.from_bytes(sig[:32], "big"), int.from_bytes(sig[32:], "big"))
  pub.verify(der, bytes.fromhex(mh), ec.ECDSA(hashes.SHA256()))   # raises on mismatch

  # screenshot_hash can only be reproduced after screenshot.enc is decrypted
  # inside the owner's EVOCK vault, which holds the AES-GCM key.


KEY HANDLING
------------
The AES-GCM key that decrypts screenshot.enc is NOT included in this package,
by design. The ciphertext is shipped so the integrity chain is inspectable, but
the plaintext screenshot can only be produced inside the owner's EVOCK vault.
If you need the image itself, ask the person who exported this package.


WHAT THIS PACKAGE CANNOT ESTABLISH
---------------------------------
A verified signature shows the manifest has not changed since it was signed. It
does not, on its own, establish:
${CANNOT_ESTABLISH.map((l) => "  * " + l).join("\n")}

EVOCK does not replace professional forensic examination or legal procedure.
`;
}
