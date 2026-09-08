/**
 * EVOCK — empty vault state (Role C, step 03 / C3, Task 5).
 *
 * Shown when the vault holds zero records. Explains what the vault is for and how
 * a record gets here — never a blank page, never a spinner that never resolves.
 * Copy is neutral and factual (spec §36): no "admissible", no "proves", no
 * "everything is local", no "recovers deleted".
 */

/**
 * @returns {HTMLElement}
 */
export function renderEmptyState() {
  const root = document.createElement("div");
  root.className = "nk-empty";

  const title = document.createElement("h2");
  title.className = "nk-empty__title";
  title.textContent = "No preserved evidence yet";

  const body = document.createElement("p");
  body.className = "nk-empty__body";
  body.textContent =
    "Open a page you want to preserve, then click Preserve Evidence in the EVOCK popup. " +
    "Each preserved page is hashed, signed and encrypted, then listed here as a dated " +
    "record you can review, verify and export.";

  root.append(title, body);
  return root;
}
