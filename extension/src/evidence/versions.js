/**
 * EVOCK — record version list access (Role B, schema 1.1).
 *
 * A pre-1.1 `StoredEvidenceRecord` has no `versions` key. It is read — never
 * rewritten on disk — as an implicit single "ai" version wrapping its manifest.
 * The first `reviseMetadata` call persists the full array (synthesised v1 + v2).
 */

/**
 * @param {import("../shared/types.js").StoredEvidenceRecord} record
 * @returns {import("../shared/types.js").RecordVersion[]}
 */
export function normalizeVersions(record) {
  if (Array.isArray(record?.versions) && record.versions.length > 0) {
    return record.versions;
  }
  return [
    {
      version: 1,
      origin: "ai",
      author: null,
      note: null,
      created_at: record?.manifest?.signature?.signed_at ?? record?.created_at ?? null,
      manifest: record?.manifest
    }
  ];
}
