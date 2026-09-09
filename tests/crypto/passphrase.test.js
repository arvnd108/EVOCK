/**
 * EVOCK — passphrase-wrapped export container tests.
 *
 * This wraps an ALREADY-BUILT export (finished PDF/ZIP bytes) behind a
 * passphrase for safer transport. It must never be confused with the vault's
 * own device-held encryption (crypto/encrypt.js) — different key, different
 * threat model, different file.
 */

import { describe, expect, it } from "vitest";
import {
  decryptWithPassphrase,
  DEFAULT_ITERATIONS,
  encryptWithPassphrase,
  MIN_PASSPHRASE_LENGTH,
  passphraseExportFilename
} from "../../extension/src/crypto/passphrase.js";

const PASSPHRASE = "correct horse battery staple";

describe("encryptWithPassphrase / decryptWithPassphrase — round trip", () => {
  it("returns bytes identical to the input for a small payload", async () => {
    const plaintext = new TextEncoder().encode("hello, this is a PDF pretending to be text");
    const container = await encryptWithPassphrase(plaintext, PASSPHRASE);

    expect(container).toBeInstanceOf(Uint8Array);
    // Header (40 bytes) + AES-GCM tag (16 bytes) + plaintext length.
    expect(container.length).toBe(40 + 16 + plaintext.length);

    const recovered = await decryptWithPassphrase(container, PASSPHRASE);
    expect(Array.from(recovered)).toEqual(Array.from(plaintext));
  });

  it("handles an empty buffer", async () => {
    const container = await encryptWithPassphrase(new Uint8Array(0), PASSPHRASE);
    const recovered = await decryptWithPassphrase(container, PASSPHRASE);
    expect(recovered.length).toBe(0);
  });

  it("handles a package-sized buffer (multi-KB, binary, not just text)", async () => {
    const plaintext = crypto.getRandomValues(new Uint8Array(64 * 1024));
    const container = await encryptWithPassphrase(plaintext, PASSPHRASE);
    const recovered = await decryptWithPassphrase(container, PASSPHRASE);
    expect(Array.from(recovered)).toEqual(Array.from(plaintext));
  });

  it("two encryptions of the same bytes produce different containers (fresh salt+IV)", async () => {
    const plaintext = new TextEncoder().encode("same input, every time");
    const a = await encryptWithPassphrase(plaintext, PASSPHRASE);
    const b = await encryptWithPassphrase(plaintext, PASSPHRASE);
    expect(Array.from(a)).not.toEqual(Array.from(b));
    // But both still decrypt back to the same plaintext.
    expect(Array.from(await decryptWithPassphrase(a, PASSPHRASE))).toEqual(Array.from(plaintext));
    expect(Array.from(await decryptWithPassphrase(b, PASSPHRASE))).toEqual(Array.from(plaintext));
  });

  it("embeds the iteration count in the container, not hard-coded on decrypt", async () => {
    const plaintext = new TextEncoder().encode("x");
    const container = await encryptWithPassphrase(plaintext, PASSPHRASE, { iterations: 1000 });
    // A different default at decrypt time must not matter — the count travels
    // with the file.
    const recovered = await decryptWithPassphrase(container, PASSPHRASE);
    expect(new TextDecoder().decode(recovered)).toBe("x");
  });
});

describe("decryptWithPassphrase — fails closed", () => {
  it("rejects on the wrong passphrase rather than returning garbage", async () => {
    const plaintext = new TextEncoder().encode("secret evidence text");
    const container = await encryptWithPassphrase(plaintext, PASSPHRASE);
    await expect(decryptWithPassphrase(container, "wrong passphrase entirely")).rejects.toThrow(
      /incorrect passphrase|corrupted/i
    );
  });

  it("rejects a container with one flipped byte in the ciphertext (GCM auth tag)", async () => {
    const plaintext = new TextEncoder().encode("tamper-evident, not just tamper-resistant");
    const container = await encryptWithPassphrase(plaintext, PASSPHRASE);
    const tampered = new Uint8Array(container);
    tampered[tampered.length - 1] ^= 0xff; // flip the last byte of the auth tag
    await expect(decryptWithPassphrase(tampered, PASSPHRASE)).rejects.toThrow();
  });

  it("rejects a truncated file", async () => {
    const plaintext = new TextEncoder().encode("some bytes");
    const container = await encryptWithPassphrase(plaintext, PASSPHRASE);
    await expect(decryptWithPassphrase(container.slice(0, 20), PASSPHRASE)).rejects.toThrow(
      /too short/i
    );
  });

  it("rejects a file that isn't an EVOCK passphrase container (magic mismatch)", async () => {
    const notOurs = new TextEncoder().encode("PK\x03\x04 this looks like a plain zip, not ours..");
    await expect(decryptWithPassphrase(notOurs, PASSPHRASE)).rejects.toThrow(/magic/i);
  });
});

describe("passphrase length is enforced by the module, not just the UI", () => {
  it("encryptWithPassphrase rejects a too-short passphrase", async () => {
    const short = "a".repeat(MIN_PASSPHRASE_LENGTH - 1);
    await expect(encryptWithPassphrase(new Uint8Array([1, 2, 3]), short)).rejects.toThrow(
      new RegExp(`at least ${MIN_PASSPHRASE_LENGTH}`)
    );
  });

  it("decryptWithPassphrase rejects a too-short passphrase before touching the container", async () => {
    await expect(decryptWithPassphrase(new Uint8Array(100), "short")).rejects.toThrow(
      new RegExp(`at least ${MIN_PASSPHRASE_LENGTH}`)
    );
  });

  it(`accepts exactly ${MIN_PASSPHRASE_LENGTH} characters`, async () => {
    const exact = "a".repeat(MIN_PASSPHRASE_LENGTH);
    const container = await encryptWithPassphrase(new TextEncoder().encode("ok"), exact);
    expect(new TextDecoder().decode(await decryptWithPassphrase(container, exact))).toBe("ok");
  });
});

describe("DEFAULT_ITERATIONS", () => {
  it("meets the OWASP (2023) PBKDF2-HMAC-SHA256 minimum", () => {
    expect(DEFAULT_ITERATIONS).toBeGreaterThanOrEqual(210_000);
  });
});

describe("passphraseExportFilename", () => {
  it("names a wrapped PDF export distinctly from the plain one", () => {
    expect(passphraseExportFilename("NK-0003", "pdf")).toBe("EVOCK-NK-0003-report.pdf.enc");
  });

  it("names a wrapped ZIP export distinctly from the plain one", () => {
    expect(passphraseExportFilename("NK-0003", "zip")).toBe("EVOCK-NK-0003-package.zip.enc");
  });

  it("falls back to a placeholder id", () => {
    expect(passphraseExportFilename(undefined, "pdf")).toBe("EVOCK-NK-XXXX-report.pdf.enc");
  });
});
