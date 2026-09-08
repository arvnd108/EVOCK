/**
 * EVOCK — module contracts.
 *
 * Contracts are frozen. Changes require all three roles to approve a PR
 * (Plan/Building Plan.md §5). Every stage of the pipeline reads and writes the
 * shapes defined here; a field that is "sometimes present" is a hashing bug
 * waiting to happen, so absent data is always `null`, never missing.
 *
 * This module is documentation only — it exports no runtime code.
 */

// ---------------------------------------------------------------------------
// §5.1 CaptureResult — output of capture/capture.js (Role A)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} CaptureResult
 * @property {string}  screenshotDataUrl  // "data:image/png;base64,..."
 * @property {string}  mimeType           // "image/png"
 * @property {number}  width
 * @property {number}  height
 * @property {string}  url                // full URL of the captured tab
 * @property {string}  domain             // hostname only
 * @property {string}  tabTitle
 * @property {string}  capturedAt         // ISO-8601 with offset, device clock
 * @property {string}  captureMethod      // "browser_extension.captureVisibleTab"
 */

// ---------------------------------------------------------------------------
// §5.2 ExtractionResult — output of any ExtractionProvider (Role A)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ExtractedMessage
 * @property {string|null} sender
 * @property {string|null} text
 * @property {string|null} visible_timestamp
 * @property {"incoming"|"outgoing"|"unknown"} type - message direction, derived
 *   by the extraction schema; never null (unrecognised -> "unknown"). Rendered
 *   as "Incoming" / "Outgoing" / "Unknown" beside the message name in every UI
 *   and export via shared/message-direction.js.
 */

/**
 * @typedef {Object} ExtractedData
 * @property {string|null} platform
 * @property {string|null} contact_name
 * @property {ExtractedMessage[]} messages
 * @property {string|null} visible_time
 * @property {string|null} date
 */

/**
 * `status: "failed"` is what an API error, a timeout or an unreachable bridge
 * produces. It still results in a complete, locked evidence record — the
 * screenshot, hashes, signature and encryption are unaffected.
 *
 * @typedef {Object} ExtractionResult
 * @property {"demo"|"vision"} provider
 * @property {string|null} model              // e.g. "openrouter/<model-id>"
 * @property {string|null} extractedAt        // ISO-8601
 * @property {ExtractedData|null} data        // null when status === "failed"
 * @property {"ok"|"failed"} status
 * @property {string|null} error              // human-readable failure reason
 */

// ---------------------------------------------------------------------------
// §5.3 EvidenceManifest v1.0 — the thing that gets hashed and signed (Role B)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ManifestSource
 * @property {string} capture_method
 * @property {string} url
 * @property {string} domain
 * @property {string} tab_title
 */

/**
 * @typedef {Object} ManifestCapture
 * @property {string} device_captured_at   // ISO-8601 with offset, device clock
 * @property {number} screenshot_width
 * @property {number} screenshot_height
 * @property {string} mime_type
 */

/**
 * @typedef {Object} ManifestEncryption
 * @property {"AES-GCM"} algorithm
 * @property {256} key_length
 * @property {string} iv                   // base64, 96-bit, unique per record
 */

/**
 * @typedef {Object} ManifestVisualArtifact
 * @property {"screenshot"} type
 * @property {"encrypted"} storage
 * @property {ManifestEncryption} encryption
 */

/**
 * The whole block is hashed — including provider, model and status — because
 * the provenance of the derived data is part of what we protect.
 *
 * @typedef {Object} ManifestAiDerivedMetadata
 * @property {string} provider
 * @property {string|null} model
 * @property {"ok"|"failed"} status
 * @property {string|null} extracted_at
 * @property {ExtractedData|null} data
 */

/**
 * Hashing order (frozen, §5.3):
 *   screenshot_hash = SHA256( raw screenshot bytes, pre-encryption )
 *   metadata_hash   = SHA256( canonicalize( ai_derived_metadata ) )
 *   manifest_hash   = SHA256( canonicalize( manifest without
 *                              .integrity.manifest_hash and without .signature ) )
 *
 * @typedef {Object} ManifestIntegrity
 * @property {"SHA-256"} hash_algorithm
 * @property {string} screenshot_hash      // hex
 * @property {string} metadata_hash        // hex
 * @property {string} manifest_hash        // hex
 */

/**
 * The public key is embedded so a third party can verify an exported package on
 * a machine that has never seen this vault.
 *
 * @typedef {Object} ManifestSignature
 * @property {"ECDSA-P256-SHA256"} algorithm
 * @property {Object} public_key_jwk
 * @property {string|null} signature       // base64, over the manifest_hash bytes
 * @property {string|null} signed_at       // ISO-8601 with offset
 */

/**
 * Device time and trusted time are separate fields with separate names. The UI
 * must never present device time as a trusted timestamp (spec §25.11, §36).
 *
 * @typedef {Object} ManifestTimestamp
 * @property {string} device_capture_time
 * @property {"not_configured"|"pending"|"ok"|"failed"} trusted_timestamp_status
 * @property {string|null} trusted_timestamp_token
 */

/**
 * @typedef {Object} EvidenceManifest
 * @property {"1.0"} schema_version
 * @property {string|null} evidence_id
 * @property {ManifestSource} source
 * @property {ManifestCapture} capture
 * @property {ManifestVisualArtifact} visual_artifact
 * @property {ManifestAiDerivedMetadata} ai_derived_metadata
 * @property {ManifestIntegrity} integrity
 * @property {ManifestSignature} signature
 * @property {ManifestTimestamp} timestamp
 */

// ---------------------------------------------------------------------------
// §5.4 StoredEvidenceRecord — what IndexedDB holds (Role B)
// ---------------------------------------------------------------------------

/**
 * One entry in `StoredEvidenceRecord.versions`. A version is never mutated once
 * written; a human correction appends a new one (spec §26.4).
 *
 * @typedef {Object} RecordVersion
 * @property {number} version                 // 1-based, dense
 * @property {"ai"|"human"} origin            // who produced this version's metadata
 * @property {string|null} author             // reserved; null for now
 * @property {string|null} note               // human edits may carry a short reason
 * @property {string} created_at              // ISO-8601 — when THIS version was signed
 * @property {EvidenceManifest} manifest      // full manifest for this version
 */

/**
 * `versions[]` was added in schema 1.1: additive, stored but not hashed, so no
 * on-disk migration. A pre-1.1 record has no `versions` key and is read as an
 * implicit single "ai" version (see `evidence/versions.js` normalizeVersions).
 *
 * Across every version the screenshot bytes, `integrity.screenshot_hash` and the
 * IV are identical — edits are metadata-only. `manifest` always mirrors the
 * latest version; `created_at` is the original preservation (timeline anchor,
 * never changes); `platform_label` and `last_verification` track the latest
 * version (`last_verification` resets to null on every revision).
 *
 * @typedef {Object} StoredEvidenceRecord
 * @property {string} evidence_id            // primary key, e.g. "NK-0001"
 * @property {EvidenceManifest} manifest     // == versions[last].manifest
 * @property {ArrayBuffer} screenshot_ciphertext  // shared by every version
 * @property {ArrayBuffer} iv                // shared by every version
 * @property {string} created_at             // original preservation — timeline anchor
 * @property {string} platform_label         // from the LATEST version's data, may be "Unknown"
 * @property {VerificationResult|null} last_verification  // of the LATEST version
 * @property {RecordVersion[]} [versions]    // 1.1+; absent on pre-1.1 records
 */

// ---------------------------------------------------------------------------
// §5.5 VerificationResult — output of verify/verifier.js (Role B)
// ---------------------------------------------------------------------------

/**
 * `details` strings are rendered verbatim by Role C's vault UI. Agree the exact
 * wording once and keep it stable (Plan/Role B.md §5).
 *
 * @typedef {Object} VerificationResult
 * @property {boolean} screenshot_hash_ok
 * @property {boolean} metadata_hash_ok
 * @property {boolean} manifest_hash_ok
 * @property {boolean} signature_ok
 * @property {"VERIFIED"|"MODIFIED"|"ERROR"} status
 * @property {string[]} details              // e.g. ["metadata hash mismatch"]
 * @property {string} verified_at            // ISO-8601 with offset
 * @property {{ screenshot_hash: string|null, metadata_hash: string|null, manifest_hash: string|null }} [current_integrity]
 *           // hashes recomputed THIS run, to pair against manifest.integrity.*
 *           // (spec §18). null where a check could not be evaluated. Added after
 *           // §5.5 was frozen: a 1.0 -> 1.1-style additive field. Existing
 *           // consumers ignore it; last_verification is stored but never hashed,
 *           // so no record on disk needs rewriting.
 */

// ---------------------------------------------------------------------------
// VaultListItem — one row of storage/vault-repo.js list() (Role B / Role C)
// ---------------------------------------------------------------------------

/**
 * The metadata-only projection `list()` returns per record. Never carries
 * `screenshot_ciphertext` or `iv`.
 *
 * `contact_label` was added after the projection was first published, for Role
 * C's timeline row — additive, no migration.
 *
 * @typedef {Object} VaultListItem
 * @property {string} evidence_id
 * @property {string} created_at              // ISO-8601, timeline sort key
 * @property {string} platform_label          // may be "Unknown"
 * @property {string|null} contact_label      // AI-derived contact name; null if none / extraction failed
 * @property {ManifestSource|null} source
 * @property {ManifestCapture|null} capture
 * @property {"ok"|"failed"|null} extraction_status
 * @property {VerificationResult|null} last_verification
 */

export {};
