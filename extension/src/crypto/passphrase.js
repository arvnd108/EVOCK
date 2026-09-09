/**
 * EVOCK — passphrase-wrapped export container (Role B/C follow-up).
 *
 * This is NOT the vault's own encryption (see `crypto/encrypt.js` — that
 * protects the screenshot at rest with a device-held, non-extractable key).
 * This module wraps an ALREADY-BUILT export (a finished PDF or ZIP, as bytes)
 * behind a passphrase the user chooses at export time, so the file is safe to
 * move over email, cloud storage, or a USB drive.
 *
 * IMPORTANT — WHAT THIS DOES NOT TOUCH: the plaintext PDF/ZIP export stays
 * available exactly as before. Wrapping is an ADDITIONAL, opt-in output, never
 * a replacement. Encrypting the manifest/signature/public-key/README is what
 * would let this app be the only party able to verify the evidence — the
 * whole point of the plaintext package (see export/verify-readme.txt.js) is
 * that a court's own expert can check it with no cooperation from EVOCK or
 * its author. Only the WRAPPER around the finished file is locked; the
 * verifiable contents inside it are unchanged once unwrapped.
 *
 * CONTAINER FORMAT (v1) — a flat byte layout, so a decrypt script needs no
 * JSON parsing, just fixed offsets:
 *
 *   offset  size  field
 *   ------  ----  -----------------------------------------------------
 *   0       8     magic ASCII "EVOCKPP1" (format id + version)
 *   8       16    salt            (random, PBKDF2 input)
 *   24      4     iterations      (uint32, big-endian)
 *   28      12    iv              (random, AES-GCM nonce)
 *   40      —     ciphertext      (AES-GCM output; includes its 16-byte tag)
 *
 * Key derivation: PBKDF2-HMAC-SHA256(passphrase, salt, iterations) -> 256-bit
 * AES-GCM key. 210,000 iterations is OWASP's 2023 PBKDF2-SHA256 minimum; it is
 * embedded in the container (not hard-coded on the decrypt side) so a future
 * default change never breaks an old file.
 *
 * DECRYPT RECIPE (any language with PBKDF2-SHA256 + AES-GCM, e.g. Python's
 * `cryptography` package):
 *
 *   data       = open("export.pdf.enc", "rb").read()
 *   magic      = data[0:8]                      # b"EVOCKPP1"
 *   salt       = data[8:24]
 *   iterations = int.from_bytes(data[24:28], "big")
 *   iv         = data[28:40]
 *   ciphertext = data[40:]                       # tag is its last 16 bytes
 *   key = PBKDF2HMAC(hashes.SHA256(), 32, salt, iterations).derive(passphrase.encode())
 *   plaintext = AESGCM(key).decrypt(iv, ciphertext, None)
 *
 * A wrong passphrase or a corrupted/truncated file fails the AES-GCM
 * authentication tag check and `decryptWithPassphrase` rejects — it never
 * returns wrong-but-plausible bytes.
 */

const MAGIC = new TextEncoder().encode("EVOCKPP1"); // 8 bytes
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const ITER_FIELD_LENGTH = 4;
const HEADER_LENGTH = MAGIC.length + SALT_LENGTH + ITER_FIELD_LENGTH + IV_LENGTH; // 40

/** OWASP (2023) minimum for PBKDF2-HMAC-SHA256. Stored in every container. */
export const DEFAULT_ITERATIONS = 210_000;

/** Enforced here too (not just in the UI) so this module is safe to call directly. */
export const MIN_PASSPHRASE_LENGTH = 8;

/**
 * @param {string} passphrase
 * @param {Uint8Array} salt
 * @param {number} iterations
 * @returns {Promise<CryptoKey>}
 */
async function deriveKey(passphrase, salt, iterations) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function assertPassphrase(passphrase) {
  if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new TypeError(
      `passphrase must be a string of at least ${MIN_PASSPHRASE_LENGTH} characters`
    );
  }
}

function toUint8(bytes, where) {
  if (bytes instanceof Uint8Array) return bytes;
  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  throw new TypeError(`${where}: expected bytes (Uint8Array/ArrayBuffer)`);
}

function writeUint32BE(n) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, false);
  return out;
}

function readUint32BE(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false);
}

/**
 * Wrap already-built export bytes (a finished PDF or ZIP) behind a passphrase.
 * Does not inspect or alter the bytes it wraps in any way.
 *
 * @param {Uint8Array|ArrayBuffer} plaintextBytes the finished PDF/ZIP file
 * @param {string} passphrase at least `MIN_PASSPHRASE_LENGTH` characters
 * @param {{ iterations?: number }} [opts]
 * @returns {Promise<Uint8Array>} the container — see the format above
 */
export async function encryptWithPassphrase(
  plaintextBytes,
  passphrase,
  { iterations = DEFAULT_ITERATIONS } = {}
) {
  assertPassphrase(passphrase);
  const plaintext = toUint8(plaintextBytes, "encryptWithPassphrase: plaintextBytes");
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new TypeError("encryptWithPassphrase: iterations must be a positive integer");
  }

  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(passphrase, salt, iterations);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext)
  );

  const out = new Uint8Array(HEADER_LENGTH + ciphertext.length);
  let o = 0;
  out.set(MAGIC, o);
  o += MAGIC.length;
  out.set(salt, o);
  o += SALT_LENGTH;
  out.set(writeUint32BE(iterations), o);
  o += ITER_FIELD_LENGTH;
  out.set(iv, o);
  o += IV_LENGTH;
  out.set(ciphertext, o);
  return out;
}

/**
 * Reverse of `encryptWithPassphrase`. Rejects — never returns wrong bytes —
 * on a bad passphrase, a corrupted container, or a container this module
 * didn't produce (magic mismatch).
 *
 * @param {Uint8Array|ArrayBuffer} container
 * @param {string} passphrase
 * @returns {Promise<Uint8Array>} the original plaintext bytes
 */
export async function decryptWithPassphrase(container, passphrase) {
  assertPassphrase(passphrase);
  const bytes = toUint8(container, "decryptWithPassphrase: container");
  if (bytes.length < HEADER_LENGTH) {
    throw new Error("decryptWithPassphrase: file is too short to be an EVOCK passphrase export");
  }

  let o = 0;
  const magic = bytes.subarray(o, o + MAGIC.length);
  o += MAGIC.length;
  if (!magic.every((b, i) => b === MAGIC[i])) {
    throw new Error(
      "decryptWithPassphrase: not an EVOCK passphrase-wrapped file (magic header mismatch)"
    );
  }
  const salt = bytes.subarray(o, o + SALT_LENGTH);
  o += SALT_LENGTH;
  const iterations = readUint32BE(bytes.subarray(o, o + ITER_FIELD_LENGTH));
  o += ITER_FIELD_LENGTH;
  const iv = bytes.subarray(o, o + IV_LENGTH);
  o += IV_LENGTH;
  const ciphertext = bytes.subarray(o);

  const key = await deriveKey(passphrase, salt, iterations);
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new Uint8Array(plaintext);
  } catch {
    // AES-GCM's authentication tag failed: wrong passphrase or the file was
    // altered/truncated after export. Deliberately vague — do not tell an
    // attacker which of the two it was.
    throw new Error("decryptWithPassphrase: incorrect passphrase, or the file is corrupted.");
  }
}

/**
 * @param {string} evidence_id
 * @param {"pdf"|"zip"} kind
 * @returns {string} e.g. "EVOCK-NK-0003-report.pdf.enc"
 */
export function passphraseExportFilename(evidence_id, kind) {
  const id = evidence_id || "NK-XXXX";
  const inner = kind === "zip" ? `${id}-package.zip` : `${id}-report.pdf`;
  return `EVOCK-${inner}.enc`;
}
