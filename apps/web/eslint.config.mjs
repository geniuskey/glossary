import js from "@eslint/js";
import babelParser from "@babel/eslint-parser";
import { globalIgnores } from "eslint/config";

export default [
  globalIgnores([".next/**", "coverage/**", "node_modules/**", "public/**"]),
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          presets: [
            "@babel/preset-typescript",
            ["@babel/preset-react", { runtime: "automatic" }],
          ],
        },
      },
    },
    rules: {
      // TypeScript's compiler is the type-safety gate; this syntax/static
      // lint deliberately does not duplicate type-aware diagnostics.
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-control-regex": "off",
      "no-useless-escape": "off",
      "no-useless-assignment": "off",
    },
  },
];
