import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node 20+ exposes globalThis.crypto.subtle natively, so Role B's crypto,
    // canonicalisation and verification modules can be tested headlessly.
    environment: "node",
    // The first glob already matches nested dirs; tests/integration/** is listed
    // explicitly so Role C's step-08 end-to-end suite has a named home.
    include: ["tests/**/*.test.js", "tests/integration/**/*.test.js"],
    // tests/extraction-schema.test.js is Role A's hand-rolled harness: it exports
    // runTests() and is driven by tests/run-tests.py, not by Vitest. It is
    // excluded here rather than rewritten, because Role A owns that file.
    exclude: ["**/node_modules/**", "tests/extraction-schema.test.js"],
    setupFiles: ["tests/setup.js"]
  }
});
