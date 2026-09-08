/**
 * EVOCK — keystore and signing tests (Role B step 03, B3).
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  getSigningKeyPair,
  getSigningPublicKeyJwk,
  SIGNING_KEY_ID
} from "../../extension/src/crypto/keystore.js";
import {
  hexToBytes,
  signManifestHash,
  verifyManifestSignature
} from "../../extension/src/crypto/sign.js";
import { bytesToHex, sha256Utf8 } from "../../extension/src/crypto/hash.js";
import { openDb, requestToPromise, STORE_KEYS } from "../../extension/src/storage/db.js";

/** A second, independent keypair — stands in for "somebody else's key". */
async function freshKeyPair() {
  return crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify"
  ]);
}

let manifestHash;

beforeAll(async () => {
  manifestHash = await sha256Utf8('{"schema_version":"1.0"}');
});

describe("hexToBytes", () => {
  it("decodes a 64-character digest to 32 bytes", () => {
    const bytes = hexToBytes(manifestHash);

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(32);
  });

  it("round-trips against bytesToHex", () => {
    expect(bytesToHex(hexToBytes(manifestHash))).toBe(manifestHash);
  });

  it("decodes a known value", () => {
    expect(Array.from(hexToBytes("00ff10"))).toEqual([0, 255, 16]);
  });

  it("accepts upper case", () => {
    expect(Array.from(hexToBytes("AABB"))).toEqual([0xaa, 0xbb]);
  });

  it("rejects malformed hex rather than decoding it as zeroes", () => {
    // parseInt("zz", 16) is NaN, which would become a zero byte and a signature
    // over the wrong input.
    expect(() => hexToBytes("zz")).toThrow(TypeError);
    expect(() => hexToBytes("abc")).toThrow(TypeError);
    expect(() => hexToBytes(null)).toThrow(TypeError);
    expect(() => hexToBytes(123)).toThrow(TypeError);
  });
});

describe("signManifestHash / verifyManifestSignature", () => {
  it("signs and verifies with the matching key", async () => {
    const { privateKey, publicKey } = await getSigningKeyPair();
    const jwk = await crypto.subtle.exportKey("jwk", publicKey);

    const signature = await signManifestHash(manifestHash, privateKey);

    expect(typeof signature).toBe("string");
    expect(await verifyManifestSignature(manifestHash, signature, jwk)).toBe(true);
  });

  it("produces a compact (~64 byte) signature", async () => {
    const { privateKey } = await getSigningKeyPair();
    const signature = await signManifestHash(manifestHash, privateKey);

    // Web Crypto emits raw r||s for ECDSA, so P-256 is 64 bytes.
    expect(atob(signature).length).toBe(64);
  });

  it("verifies with a key supplied by the caller, not the local keystore", async () => {
    // This is the third-party path: an exported package must verify using only
    // the JWK embedded in its own manifest.
    const foreign = await freshKeyPair();
    const foreignJwk = await crypto.subtle.exportKey("jwk", foreign.publicKey);
    const signature = await signManifestHash(manifestHash, foreign.privateKey);

    expect(await verifyManifestSignature(manifestHash, signature, foreignJwk)).toBe(true);
  });

  it("returns false for the wrong public key, without throwing", async () => {
    const { privateKey } = await getSigningKeyPair();
    const signature = await signManifestHash(manifestHash, privateKey);

    const other = await freshKeyPair();
    const otherJwk = await crypto.subtle.exportKey("jwk", other.publicKey);

    await expect(verifyManifestSignature(manifestHash, signature, otherJwk)).resolves.toBe(
      false
    );
  });

  it("returns false for a tampered hash", async () => {
    const { privateKey, publicKey } = await getSigningKeyPair();
    const jwk = await crypto.subtle.exportKey("jwk", publicKey);
    const signature = await signManifestHash(manifestHash, privateKey);

    const tampered = `${manifestHash.slice(0, 63)}${manifestHash[63] === "a" ? "b" : "a"}`;

    expect(await verifyManifestSignature(tampered, signature, jwk)).toBe(false);
  });

  it("returns false for a corrupted signature", async () => {
    const { privateKey, publicKey } = await getSigningKeyPair();
    const jwk = await crypto.subtle.exportKey("jwk", publicKey);
    const signature = await signManifestHash(manifestHash, privateKey);

    const corrupted = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;

    expect(await verifyManifestSignature(manifestHash, corrupted, jwk)).toBe(false);
  });

  it("returns false for every malformed input, never throwing", async () => {
    const { privateKey, publicKey } = await getSigningKeyPair();
    const jwk = await crypto.subtle.exportKey("jwk", publicKey);
    const signature = await signManifestHash(manifestHash, privateKey);

    const cases = [
      ["malformed jwk", manifestHash, signature, {}],
      ["null jwk", manifestHash, signature, null],
      ["string jwk", manifestHash, signature, "not-a-key"],
      ["wrong-curve jwk", manifestHash, signature, { ...jwk, crv: "P-384" }],
      ["truncated jwk", manifestHash, signature, { kty: "EC", crv: "P-256" }],
      ["non-base64 signature", manifestHash, "!!not base64!!", jwk],
      ["empty signature", manifestHash, "", jwk],
      ["null signature", manifestHash, null, jwk],
      ["short hash", "zz", signature, jwk],
      ["non-hex hash", "g".repeat(64), signature, jwk],
      ["null hash", null, signature, jwk]
    ];

    for (const [label, hash, sig, key] of cases) {
      await expect(
        verifyManifestSignature(hash, sig, key),
        `${label} should verify false`
      ).resolves.toBe(false);
    }
  });

  it("refuses to sign anything that is not a 64-character digest", async () => {
    const { privateKey } = await getSigningKeyPair();

    await expect(signManifestHash("abc", privateKey)).rejects.toThrow(TypeError);
    await expect(signManifestHash(manifestHash, null)).rejects.toThrow(TypeError);
  });
});

describe("keystore", () => {
  it("keeps the private key non-extractable", async () => {
    const { privateKey } = await getSigningKeyPair();

    expect(privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("pkcs8", privateKey)).rejects.toThrow();
    await expect(crypto.subtle.exportKey("jwk", privateKey)).rejects.toThrow();
  });

  it("exports the public key as a P-256 JWK", async () => {
    const jwk = await getSigningPublicKeyJwk();

    expect(jwk.kty).toBe("EC");
    expect(jwk.crv).toBe("P-256");
    expect(typeof jwk.x).toBe("string");
    expect(typeof jwk.y).toBe("string");
    expect(jwk.d).toBeUndefined(); // never the private scalar
  });

  it("returns the same keypair on repeated calls", async () => {
    expect(await getSigningKeyPair()).toBe(await getSigningKeyPair());
  });

  it("persists one keypair across a module reset", async () => {
    const before = await getSigningPublicKeyJwk();

    vi.resetModules();
    const reloaded = await import("../../extension/src/crypto/keystore.js");
    const after = await reloaded.getSigningPublicKeyJwk();

    expect(after).toEqual(before);
  });

  it("stores exactly one signing record, holding CryptoKey objects", async () => {
    await getSigningKeyPair();
    const db = await openDb();
    const record = await requestToPromise(
      db.transaction(STORE_KEYS, "readonly").objectStore(STORE_KEYS).get(SIGNING_KEY_ID)
    );

    expect(record.id).toBe(SIGNING_KEY_ID);
    expect(record.privateKey).toBeInstanceOf(CryptoKey);
    expect(record.publicKey).toBeInstanceOf(CryptoKey);
    // The stored private key is still non-extractable after the round trip:
    // structured clone moved the key without ever exposing its material.
    expect(record.privateKey.extractable).toBe(false);
  });

  it("does not generate a second keypair under concurrent callers", async () => {
    vi.resetModules();
    const reloaded = await import("../../extension/src/crypto/keystore.js");

    const [a, b, c] = await Promise.all([
      reloaded.getSigningPublicKeyJwk(),
      reloaded.getSigningPublicKeyJwk(),
      reloaded.getSigningPublicKeyJwk()
    ]);

    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("signs verifiably with the key reloaded from storage", async () => {
    vi.resetModules();
    const keystore = await import("../../extension/src/crypto/keystore.js");
    const signing = await import("../../extension/src/crypto/sign.js");

    const { privateKey } = await keystore.getSigningKeyPair();
    const jwk = await keystore.getSigningPublicKeyJwk();
    const signature = await signing.signManifestHash(manifestHash, privateKey);

    expect(await signing.verifyManifestSignature(manifestHash, signature, jwk)).toBe(true);
  });
});

describe("signing — properties worth stating explicitly", () => {
  it("produces a different signature each time, and both verify", async () => {
    // ECDSA is randomised. Nothing may compare two signatures for equality as a
    // way of comparing the records they cover.
    const { privateKey, publicKey } = await getSigningKeyPair();
    const jwk = await crypto.subtle.exportKey("jwk", publicKey);

    const first = await signManifestHash(manifestHash, privateKey);
    const second = await signManifestHash(manifestHash, privateKey);

    expect(second).not.toBe(first);
    expect(await verifyManifestSignature(manifestHash, first, jwk)).toBe(true);
    expect(await verifyManifestSignature(manifestHash, second, jwk)).toBe(true);
  });

  it("rejects a key that is not permitted to verify", async () => {
    const { privateKey, publicKey } = await getSigningKeyPair();
    const jwk = await crypto.subtle.exportKey("jwk", publicKey);
    const signature = await signManifestHash(manifestHash, privateKey);

    expect(await verifyManifestSignature(manifestHash, signature, { ...jwk, key_ops: ["sign"] })).toBe(
      false
    );
  });

  it("rejects a private JWK smuggled into the manifest's key slot", async () => {
    const extractable = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"]
    );
    const privateJwk = await crypto.subtle.exportKey("jwk", extractable.privateKey);
    const signature = await signManifestHash(manifestHash, extractable.privateKey);

    expect(await verifyManifestSignature(manifestHash, signature, privateJwk)).toBe(false);
  });
});

describe("signing — end to end with a real manifest", () => {
  it("signs a built manifest and verifies it from the manifest's own key", async () => {
    const { buildManifest, attachSignature } = await import(
      "../../extension/src/evidence/manifest-builder.js"
    );
    const { loadFixture } = await import("../helpers/fixtures.js");

    const { privateKey } = await getSigningKeyPair();
    const public_key_jwk = await getSigningPublicKeyJwk();

    const { manifest, manifest_hash } = await buildManifest({
      capture: loadFixture("capture.sample"),
      extraction: loadFixture("extraction.ok.sample"),
      evidence_id: "NK-0001",
      iv_b64: "aXY=",
      public_key_jwk
    });

    attachSignature(manifest, {
      signature_b64: await signManifestHash(manifest_hash, privateKey),
      signed_at: "2026-09-01T23:31:20+05:30"
    });

    expect(
      await verifyManifestSignature(
        manifest.integrity.manifest_hash,
        manifest.signature.signature,
        manifest.signature.public_key_jwk
      )
    ).toBe(true);
  });

  it("verifies from exported JSON alone, with no access to the keystore", async () => {
    // Role B.md §7 item 8: an exported package must verify on a machine that has
    // never seen this vault.
    const { buildManifest, attachSignature } = await import(
      "../../extension/src/evidence/manifest-builder.js"
    );
    const { loadFixture } = await import("../helpers/fixtures.js");

    const { privateKey } = await getSigningKeyPair();
    const public_key_jwk = await getSigningPublicKeyJwk();

    const { manifest, manifest_hash } = await buildManifest({
      capture: loadFixture("capture.sample"),
      extraction: loadFixture("extraction.ok.sample"),
      evidence_id: "NK-0001",
      iv_b64: "aXY=",
      public_key_jwk
    });
    attachSignature(manifest, {
      signature_b64: await signManifestHash(manifest_hash, privateKey),
      signed_at: "2026-09-01T23:31:20+05:30"
    });

    const exported = JSON.parse(JSON.stringify(manifest));

    expect(
      await verifyManifestSignature(
        exported.integrity.manifest_hash,
        exported.signature.signature,
        exported.signature.public_key_jwk
      )
    ).toBe(true);
  });
});

describe("keystore — damaged records", () => {
  it("reports a half-written keystore record clearly, not as an opaque ConstraintError", async () => {
    // A record holding a public key but no private key makes the vault unable to
    // sign anything, permanently. The previous behaviour was a bare
    // ConstraintError from the failed `add`, which says nothing about the cause.
    const { txDone } = await import("../../extension/src/storage/db.js");
    const db = await openDb();

    // Generate before opening the transaction: an IndexedDB transaction cannot
    // survive an await on a non-IDB promise.
    const orphan = await freshKeyPair();
    const tx = db.transaction(STORE_KEYS, "readwrite");
    tx.objectStore(STORE_KEYS).put({ id: SIGNING_KEY_ID, publicKey: orphan.publicKey });
    await txDone(tx);

    vi.resetModules();
    const keystore = await import("../../extension/src/crypto/keystore.js");

    await expect(keystore.getSigningKeyPair()).rejects.toThrow(/signing key/i);

    // Clean up so later tests in this file get a healthy vault again.
    const cleanupTx = db.transaction(STORE_KEYS, "readwrite");
    cleanupTx.objectStore(STORE_KEYS).delete(SIGNING_KEY_ID);
    await txDone(cleanupTx);
  });
});

describe("inspectManifestSignature — classifies why a signature failed", () => {
  it("returns valid for a good signature", async () => {
    const { inspectManifestSignature } = await import("../../extension/src/crypto/sign.js");
    const { privateKey, publicKey } = await getSigningKeyPair();
    const jwk = await crypto.subtle.exportKey("jwk", publicKey);
    const sig = await signManifestHash(manifestHash, privateKey);

    expect(await inspectManifestSignature(manifestHash, sig, jwk)).toEqual({
      ok: true,
      reason: "valid"
    });
  });

  it("returns key_malformed for a broken JWK, invalid for a wrong signature", async () => {
    const { inspectManifestSignature } = await import("../../extension/src/crypto/sign.js");
    const { privateKey } = await getSigningKeyPair();
    const sig = await signManifestHash(manifestHash, privateKey);

    expect((await inspectManifestSignature(manifestHash, sig, { kty: "EC", crv: "P-256" })).reason).toBe(
      "key_malformed"
    );

    const otherPair = await freshKeyPair();
    const otherJwk = await crypto.subtle.exportKey("jwk", otherPair.publicKey);
    expect((await inspectManifestSignature(manifestHash, sig, otherJwk)).reason).toBe("invalid");
  });

  it("returns bad_input for a non-hex hash", async () => {
    const { inspectManifestSignature } = await import("../../extension/src/crypto/sign.js");
    expect((await inspectManifestSignature("nothex", "x", {})).reason).toBe("bad_input");
  });
});
