/**
 * GET /api/standards — public catalog of every content-design standard.
 *
 * Read-only, unauthenticated, edge-cacheable. Backs the MCP server's
 * `list_standards` tool and the `contentrx://standards` resource so any
 * MCP client can browse the spec without needing an API key.
 *
 * The shape is the engine's `standards_library.json` verbatim — same
 * data the Python pipeline reads at evaluation time. Anyone consuming
 * this can rely on it matching the engine version.
 */

import { NextResponse } from "next/server";
import library from "@/content_checker/standards/standards_library.json";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  const res = NextResponse.json(library, {
    headers: {
      // 1 hour at the edge, longer in shared caches. The library updates
      // are version-bumped by hand, so stale-while-revalidate is fine.
      "cache-control":
        "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}
