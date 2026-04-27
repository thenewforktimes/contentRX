/**
 * CORS allowlist for plugin-callable endpoints.
 *
 * Audit S5 — defense-in-depth. The Figma plugin iframe sends
 * `Origin: null` (sandboxed srcdoc), so the original `*` was correct
 * for current callers but unnecessarily wide. This helper echoes
 * the request Origin back when it's on the allowlist, omits the
 * header otherwise, and adds `Vary: Origin` so caches don't fold
 * responses across origins.
 *
 * The endpoints don't read cookies — auth is `Authorization: Bearer
 * cx_...`, never a credentialed cookie — so an origin that's NOT
 * on the list still can't forge an authenticated call. The narrowing
 * is belt-and-suspenders, and turns the affected routes into no-ops
 * for any future browser-side caller we didn't anticipate.
 *
 * Allowed origins:
 *   - "null"                     — Figma plugin UI (sandboxed iframe)
 *   - https://www.figma.com      — Figma web (parent of the plugin frame)
 *   - https://figma.com          — apex
 *   - http://localhost:3000      — local dev (only when NODE_ENV=development)
 *
 * Server-to-server callers (CLI, MCP, LSP, GitHub Action) send no
 * Origin header. CORS doesn't apply to those requests — the browser
 * doesn't enforce same-origin on non-browser clients — so we still
 * emit the headers without an Allow-Origin so cache control headers
 * stay consistent.
 */

import { NextResponse } from "next/server";

const STATIC_ALLOWED = new Set<string>([
  "null",
  "https://www.figma.com",
  "https://figma.com",
]);

function isAllowed(origin: string | null): boolean {
  if (!origin) return false;
  if (STATIC_ALLOWED.has(origin)) return true;
  if (
    process.env.NODE_ENV === "development" &&
    /^http:\/\/localhost(:\d+)?$/.test(origin)
  ) {
    return true;
  }
  return false;
}

const COMMON_HEADERS = {
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
} as const;

/**
 * Build the CORS header set for a response.
 *
 * Reads the request's Origin header — when it's on the allowlist,
 * echoes it back as Allow-Origin and adds Vary: Origin. When the
 * origin is missing (server-to-server) or not allowed, omits
 * Allow-Origin so the browser denies the response.
 */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!isAllowed(origin)) {
    return { ...COMMON_HEADERS };
  }
  return {
    ...COMMON_HEADERS,
    "Access-Control-Allow-Origin": origin!,
    Vary: "Origin",
  };
}

/**
 * Build a NextResponse.json() with CORS headers attached.
 *
 * Convenience for routes that just want `corsJson(req, body, init)`
 * instead of building and decorating a NextResponse manually.
 */
export function corsJson(
  req: Request,
  body: unknown,
  init?: ResponseInit,
): NextResponse {
  const res = NextResponse.json(body, init);
  for (const [k, v] of Object.entries(corsHeaders(req))) {
    res.headers.set(k, v);
  }
  return res;
}

/**
 * Minimal Response for OPTIONS preflight. 204 status, CORS headers
 * derived from the request.
 */
export function corsPreflight(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}
