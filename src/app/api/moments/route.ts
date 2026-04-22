/**
 * GET /api/moments — public catalog of moments + standards weights.
 *
 * Read-only, unauthenticated. Backs the MCP server's `list_standards`
 * filter (when a moment is provided) and the `contentrx://moments`
 * resource. The data lives in the Python engine
 * (`src/content_checker/moments.py` — MOMENT_TAXONOMY +
 * MOMENT_WEIGHTS), so this route delegates to /api/evaluate with
 * mode=catalog rather than duplicating the moment list in TS.
 *
 * Cached at the edge — moments only change when a developer edits
 * moments.py and ships a new deployment.
 */

import { NextResponse } from "next/server";
import { catalog } from "@/lib/evaluate";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function withCors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  let result;
  try {
    result = await catalog();
  } catch (err) {
    console.error("/api/moments catalog() failed:", err);
    return withCors(
      NextResponse.json(
        { error: "Catalog service unavailable" },
        { status: 502 },
      ),
    );
  }
  return withCors(
    NextResponse.json(result.result, {
      headers: {
        "cache-control":
          "public, max-age=3600, stale-while-revalidate=86400",
      },
    }),
  );
}
