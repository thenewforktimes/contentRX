import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * Vitest config for the Next.js web app (src/**).
 *
 * Scope is intentionally narrow: pure-logic tests for lib helpers
 * (hashing, envelope, quotas, taxonomy, handoff validation, auth
 * token parsing). Route-level and DB-mocked tests are tracked for
 * follow-up PRs — they need heavier mocking of Drizzle, Clerk,
 * Redis, and the Python engine.
 *
 * Python engine tests still run via pytest (src/content_checker/).
 * This config does NOT cover those — npm test and pytest run as
 * independent suites.
 *
 * @vitejs/plugin-react fixes a vite import-analysis interaction with
 * the project's `jsx: preserve` tsconfig setting (Next.js needs that
 * setting; vite doesn't transform JSX without an explicit plugin).
 * Without this plugin, any new .tsx file imported by a test would
 * fail with "Failed to parse source for import analysis." Existing
 * .tsx files happened to work because of cached pre-bundling on the
 * first run; new files added during a session triggered the parse
 * error. The plugin handles JSX → JS uniformly, removing the gap.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["node_modules", ".next", ".vercel", "docs-site", "cli-client", "mcp-server", "github-action"],
  },
});
