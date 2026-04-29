import { defineConfig } from "vitest/config";
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
 */
export default defineConfig({
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
