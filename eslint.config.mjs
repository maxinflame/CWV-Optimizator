import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier/flat";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores([
    "node_modules/",
    "runs/",
    "coverage/",
    "fixtures/slow-site/dist/",
    "src/gui/web/dist/",
  ]),
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}", "*.ts", "*.mjs"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["src/gui/web/src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  },
  prettier,
);
