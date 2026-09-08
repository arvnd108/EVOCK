# `extension/src/vendor/` — third-party browser builds

The MVP still loads unpacked from `extension/` with **no bundler** (see
`docs/role-c-status.md`, step 00 "Build strategy decision"). Step 07 (export)
adds the project's first two runtime dependencies, `jspdf` and `jszip`. Rather
than turn on a bundler for two files, their pre-built browser bundles are
vendored here and loaded as classic `<script>` tags by `src/vault/vault.html`:

| File | Upstream | Global it defines |
|---|---|---|
| `jspdf.umd.min.js` | `node_modules/jspdf/dist/jspdf.umd.min.js` | `window.jspdf` (`.jsPDF`) |
| `jszip.min.js` | `node_modules/jszip/dist/jszip.min.js` | `window.JSZip` |

Exact versions are in `VERSIONS.txt` and pinned in the repo `package.json`
`dependencies`. The export modules under `src/export/` read the library off
`globalThis` at call time through an injectable seam, so Vitest imports the npm
package directly and never touches these files.

## Regenerating after a version bump

```bash
npm install jspdf@<v> jszip@<v>
cp node_modules/jspdf/dist/jspdf.umd.min.js extension/src/vendor/jspdf.umd.min.js
cp node_modules/jszip/dist/jszip.min.js     extension/src/vendor/jszip.min.js
node -e "console.log('jspdf', require('jspdf/package.json').version); console.log('jszip', require('jszip/package.json').version)" > extension/src/vendor/VERSIONS.txt
```

Nothing in `src/` is edited by hand here. If the bundler decision is revisited,
delete this folder and the two `<script>` tags and `import` the packages instead.
