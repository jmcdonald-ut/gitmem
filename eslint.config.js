import { defineConfig } from "eslint/config"
import js from "@eslint/js"
import tseslint from "typescript-eslint"
import reactHooks from "eslint-plugin-react-hooks"
import boundaries from "eslint-plugin-boundaries"
import prettier from "eslint-config-prettier"

export default defineConfig([
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    plugins: {
      "react-hooks": reactHooks,
      boundaries,
    },
    settings: {
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: "./tsconfig.json",
        },
      },
      "boundaries/elements": [
        { type: "command-utils", pattern: "src/commands/utils", mode: "folder" },
        { type: "command", pattern: "src/commands/*", mode: "folder" },
        { type: "db", pattern: "src/db", mode: "folder" },
        { type: "services", pattern: "src/services", mode: "folder" },
        { type: "shared", pattern: "src/*", mode: "file" },
      ],
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/consistent-type-imports": ["error", {
        prefer: "type-imports",
      }],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "boundaries/element-types": ["error", {
        default: "allow",
        rules: [
          {
            from: ["command"],
            disallow: ["command"],
            message: "Commands cannot import from other commands. Move shared code to src/commands/utils/, or promote it to src/ or a subdirectory of src/.",
          },
          {
            from: ["db"],
            disallow: ["services"],
            message: "The db layer cannot import from services — services depend on db, not the other way around. If both layers need the same code, move it to src/ or a subdirectory of src/.",
          },
        ],
      }],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/await-thenable": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/only-throw-error": "off",
    },
  },
  {
    files: ["src/db/**/*.ts", "src/services/**/*.ts"],
    rules: {
      "no-console": ["error", { allow: ["error", "warn"] }],
    },
  },
  prettier,
  {
    ignores: ["gitmem", "coverage/"],
  },
])
