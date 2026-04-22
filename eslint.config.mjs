import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // docs-site is its own Next.js project with its own lint surface;
      // running the main app's lint over its node_modules + generated
      // files produces thousands of irrelevant findings.
      "docs-site/**",
      // Same for cli-client + github-action — separate sub-projects.
      "cli-client/**",
      "github-action/**",
    ],
  },
];

export default eslintConfig;
