/**
 * Surface (origin) enum — single source of truth for the `source`
 * column on `usage_events` and `violations`, and for the request-body
 * validator on `/api/check`.
 *
 * Each entry is an official caller of `/api/check`:
 *   - dashboard: the web app's own try-a-check panel
 *   - cli:       contentrx-cli (terminal)
 *   - action:    GitHub Action running in CI
 *   - lsp:       LSP server / editor extensions
 *   - mcp:       MCP server (Claude Code, Cursor, etc.)
 *
 * Adding a new official surface = add it here, ship the migration to
 * widen the enum on both `usage_events` and `violations`, and update
 * the dashboard's surface-attribution rendering. The single export
 * keeps the three sites that previously hard-coded this list (the
 * /api/check zod validator and the two Drizzle column definitions)
 * impossible to drift.
 */

export const SURFACE_SOURCES = [
  "dashboard",
  "cli",
  "action",
  "lsp",
  "mcp",
] as const;

export type SurfaceSource = (typeof SURFACE_SOURCES)[number];
