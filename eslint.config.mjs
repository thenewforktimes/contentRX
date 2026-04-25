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
      // Recursive globs so build artifacts and dependency trees are
      // skipped wherever they live, including inside git worktrees
      // under `.claude/worktrees/<slug>/.next/` (which earlier surfaced
      // ~22k false-positive findings on local `npm run lint`).
      "**/node_modules/**",
      "**/.next/**",
      "**/out/**",
      "**/build/**",
      "**/dist/**",
      // Python venvs ship vendored JS (coverage HTML templates,
      // docutils slide themes) we don't own and shouldn't lint.
      "**/.venv/**",
      "**/venv/**",
      "**/__pycache__/**",
      "**/.pytest_cache/**",
      "next-env.d.ts",
      // git worktrees live under .claude/. Each worktree carries its
      // own copy of the source — linting them duplicates findings and
      // catches stale artifacts. Run lint in the worktree itself if
      // you need to lint that branch.
      ".claude/**",
      // docs-site is its own Next.js project with its own lint surface;
      // running the main app's lint over its node_modules + generated
      // files produces thousands of irrelevant findings.
      "docs-site/**",
      // Same for cli-client + github-action + mcp-server — separate
      // sub-projects with their own toolchains.
      "cli-client/**",
      "github-action/**",
      "mcp-server/**",
      // LSP server (Python) and editor extensions (own tsconfig +
      // compile target) ship independently of the main Next.js app.
      "lsp-server/**",
      "editor-extensions/**",
    ],
  },
];

export default eslintConfig;
