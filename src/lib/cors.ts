/**
 * CORS allowlist for the public API endpoints.
 *
 * Audit S5 — defense-in-depth. The only browser caller was the Figma
 * plugin (sandboxed iframe, `Origin: null`), retired 2026-05-16; the
 * static allowlist is now empty. This helper echoes the request
 * Origin back when it's on the allowlist, omits the header otherwise,
 * and adds `Vary: Origin` so caches don't fold responses across
 * origins.
 *
 * The endpoints don't read cookies — auth is `Authorization: Bearer
 * cx_...`, never a credentialed cookie — so an origin that's NOT
 * on the list still can't forge an authenticated call. The narrowing
 * is belt-and-suspenders, and turns the affected routes into no-ops
 * for any future browser-side caller we didn't anticipate.
 *
 * Allowed origins:
 *   - http://localhost:3000      — local dev (only when NODE_ENV=development)
 *
 * The Figma plugin (the only browser caller) was retired 2026-05-16,
 * so no static origin is allowed. The helper stays as the seam if a
 * browser caller is ever reintroduced.
 *
 * Server-to-server callers (CLI, MCP, LSP, GitHub Action) send no
 * Origin header. CORS doesn't apply to those requests — the browser
 * doesn't enforce same-origin on non-browser clients — so we still
 * emit the headers without an Allow-Origin so cache control headers
 * stay consistent.
 */

import { NextResponse } from "next/server";

// Empty since the Figma plugin (the only browser caller) was retired
// 2026-05-16. Kept as the seam: add an origin here if a browser
// caller is ever reintroduced. localhost-dev is handled in isAllowed().
const STATIC_ALLOWED = new Set<string>([]);

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
