/**
 * EVOCK — Evidence Core public surface (Role B).
 *
 * Role A's service worker and Role C's vault/export UI import from here, not
 * from the individual modules. Everything below is a committed contract; the
 * internals behind it (canonicalisation, the keystore, the vault schema) are
 * not.
 *
 *   lockEvidence({ capture, extraction, emit })  -> StoredEvidenceRecord
 *     One atomic call: hash -> encrypt -> build -> sign -> timestamp -> store.
 *     Throws on any failure and writes nothing; the caller owns the
 *     screenshot-only fallback.
 *
 *   verifyEvidence(evidence_id, { persist, version }) -> VerificationResult
 *     Recomputes every fingerprint and checks the signature. Never rejects for
 *     a tampered record — that is a result with status MODIFIED or ERROR.
 *     `version` selects an earlier version (spec §26.4); omitted = latest.
 *
 *   reviseMetadata(evidence_id, data, { note })  -> StoredEvidenceRecord
 *     Appends a human-corrected, re-signed version. Never mutates an existing
 *     one; the screenshot and its hash are shared across all versions.
 *
 *   verifyManifestSignature(hashHex, sigB64, jwk) -> boolean
 *   reduceManifestForHashing(manifest)            -> reduced copy
 *     The two primitives a third party needs to verify an exported package with
 *     nothing but its manifest.json and screenshot bytes.
 *
 *   VERIFY_DETAILS
 *     Frozen detail strings; Role C's UI renders them verbatim.
 */

export { lockEvidence } from "./lock-evidence.js";
export { reviseMetadata } from "./revise-metadata.js";
export { normalizeVersions } from "./versions.js";
export { verifyEvidence, VERIFY_DETAILS } from "../verify/verifier.js";
export { verifyManifestSignature } from "../crypto/sign.js";
export { reduceManifestForHashing } from "./manifest-builder.js";
