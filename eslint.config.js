/**
 * EVOCK — shared ESLint flat config (Role C, step 00 / C1).
 *
 * One config for three people. The rules that run as `error` are the ones that
 * catch real bugs in an MV3 extension — undeclared globals, unused bindings,
 * unreachable code. Stylistic and promise-hygiene rules run as `warn`: they are
 * signal, not a merge gate, and `eslint .` still exits 0 so `npm run lint`
 * passes on warnings. Formatting is delegated entirely to Prettier
 * (`eslint-config-prettier` disables every formatting rule here).
 *
 * Scope note (step 00): Role A owns `extension/src/{background,popup,capture,
 * extraction}` and `bridge/`; Role B owns `extension/src/{crypto,evidence,
 * storage,verify}` and most of `shared/`. This step does not rewrite their
 * logic — see docs/role-c-status.md.
 */

import js from "@eslint/js";
import promise from "eslint-plugin-promise";
import prettier from "eslint-config-prettier";
import globals from "globals";

const correctness = {
  "no-unused-vars": [
    "error",
    { args: "after-used", argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
  ],
  "no-undef": "error",
  "no-console": "off",
  // `try { JSON.parse(x) } catch {}` — deliberate best-effort parse with a
  // raw-text fallback — appears in the bridge and the vision provider.
  "no-empty": ["error", { allowEmptyCatch: true }],
  "sort-imports": [
    "warn",
    { ignoreCase: true, ignoreDeclarationSort: true, allowSeparatedGroups: true }
  ],
  // The worker and lock-evidence deliberately use the two-arg
  // `.then(onFulfilled, onRejected)` form to answer `sendMessage`; that handles
  // rejection, so accept it.
  "promise/catch-or-return": ["warn", { allowFinally: true, allowThen: true }],
  "promise/always-return": "off",
  "promise/no-callback-in-promise": "off"
};

export default [
  {
    ignores: ["node_modules/**", "dist/**", "**/*.min.js", "**/__pycache__/**", "**/*.pyc"]
  },

  js.configs.recommended,
  promise.configs["flat/recommended"],
  // Turns off every ESLint rule that would fight Prettier's formatting.
  prettier,

  // Extension source — service worker + extension pages (popup, and the vault
  // page landing in step 03).
  {
    files: ["extension/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        ...globals.webextensions,
        // Dev-build flag read by verify/tamper-demo.js; provided at runtime.
        __EVOCK_DEV__: "readonly"
      }
    },
    rules: correctness
  },

  // Test suite + root config files — Node, plus the browser/IDB/crypto globals
  // the setup file registers.
  {
    files: ["tests/**/*.js", "vitest.config.js", "eslint.config.js", "*.config.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
        __EVOCK_DEV__: "writable"
      }
    },
    rules: {
      ...correctness,
      // Tests legitimately import-and-stub; keep the unused check but relaxed.
      "no-unused-vars": ["error", { args: "none", varsIgnorePattern: "^_" }]
    }
  },

  // Local API-key bridge — plain Node ES modules.
  {
    files: ["bridge/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node }
    },
    rules: correctness
  }
];
