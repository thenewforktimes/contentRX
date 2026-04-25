/**
 * Actor-role inference — human-eval build plan Session 3.
 *
 * Each override surface has a default actor-role bias: the Figma plugin
 * is used mostly by designers; the CLI and GitHub Action mostly by
 * engineers; the web dashboard skews PM. The plan treats role as a
 * weighted signal, not a gate — a designer override is more
 * informative than an engineer override for content-design questions,
 * but both are captured.
 *
 * The client-side surface can override the inferred role (e.g., a
 * designer using the CLI can pass `actor_role: "designer"` explicitly).
 * This helper provides the default when nothing is supplied.
 */

export type ActorRole = "designer" | "engineer" | "pm" | "other";
export type OverrideSource = "plugin" | "cli" | "action" | "dashboard" | "lsp" | "mcp";

export const ACTOR_ROLES: readonly ActorRole[] = [
  "designer",
  "engineer",
  "pm",
  "other",
] as const;

/**
 * Default actor role per surface. Explicit on every value so adding a
 * new source forces a compile-time decision here.
 */
const SOURCE_ROLE_DEFAULTS: Record<OverrideSource, ActorRole> = {
  plugin: "designer",
  cli: "engineer",
  action: "engineer",
  dashboard: "pm",
  // LSP runs in editor extensions (VS Code, Cursor, Neovim) — almost
  // exclusively engineers. MCP servers are driven by Claude Code /
  // Cursor / Claude desktop, again primarily engineers.
  lsp: "engineer",
  mcp: "engineer",
};

/**
 * Infer the default actor-role from the override source. When the
 * client supplies its own `actor_role`, that value wins — this helper
 * is only the fallback.
 */
export function inferActorRole(source: OverrideSource): ActorRole {
  return SOURCE_ROLE_DEFAULTS[source];
}

/**
 * Resolve the actor role to use for a given override, preferring the
 * client-supplied value. Returns `null` only when the source is
 * unrecognized — callers should treat that as "unknown" and not gate
 * on it.
 */
export function resolveActorRole(
  source: OverrideSource,
  explicit: ActorRole | undefined | null,
): ActorRole | null {
  if (explicit && ACTOR_ROLES.includes(explicit)) return explicit;
  const fallback = SOURCE_ROLE_DEFAULTS[source];
  return fallback ?? null;
}
