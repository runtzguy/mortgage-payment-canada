import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // TypeScript already resolves identifiers; no-undef only produces
      // false positives on type-only and ambient names.
      "no-undef": "off",
      // Logging is a deliberate choice here: the two places that do it carry
      // an explicit disable comment, so new ones have to be justified too.
      "no-console": "error",
      // A leading underscore marks a binding that exists for its position, not
      // its value — Express detects error middleware by arity, so `_next` has
      // to stay in the signature even though nothing calls it.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["client/**/*.tsx"],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  prettier,
);
