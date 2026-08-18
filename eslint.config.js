import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores(["dist", "coverage", "playwright-report", "test-results"]),
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx}"],
  })),
  ...tseslint.configs.stylisticTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx}"],
  })),
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },
  {
    files: ["src/sim/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/app/**",
                "@/ui/**",
                "@/rendering/**",
                "**/app/**",
                "**/ui/**",
                "**/rendering/**",
              ],
              message: "The authoritative simulator cannot depend on app, UI, or rendering code.",
            },
          ],
          paths: [
            { name: "react", message: "The simulator must remain headless." },
            { name: "react-dom", message: "The simulator must remain headless." },
            { name: "pixi.js", message: "The simulator must remain renderer-independent." },
          ],
        },
      ],
    },
  },
  {
    files: ["src/ui/**/*.{ts,tsx}", "src/rendering/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/sim/**", "**/sim/**"],
              message:
                "UI and rendering consume GameClient/view-model contracts, not simulator internals.",
            },
          ],
        },
      ],
    },
  },
);
