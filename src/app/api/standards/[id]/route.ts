/**
 * GET /api/standards/[id] — single standard, by ID.
 *
 * Companion to GET /api/standards. Returns the standard with the
 * matching ID plus its category metadata (name, id) so callers can
 * render with category context. 404 if the ID doesn't exist.
 *
 * Public, unauthenticated, edge-cacheable — same contract as
 * /api/standards.
 */

import { NextResponse } from "next/server";
import library from "@/content_checker/standards/standards_library.json";

type Standard = {
  id: string;
  rule: string;
  correct?: string;
  incorrect?: string;
  rule_type?: string;
  checkable_from?: string;
  relevant_content_types?: string[];
  content_type_notes?: Record<string, string>;
};

type RawLibrary = {
  categories: Array<{ id: string; name: string; standards: Standard[] }>;
};

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

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const lib = library as RawLibrary;
  for (const cat of lib.categories) {
    const std = cat.standards.find((s) => s.id === id);
    if (std) {
      return withCors(
        NextResponse.json(
          { standard: std, category: { id: cat.id, name: cat.name } },
          {
            headers: {
              "cache-control":
                "public, max-age=3600, stale-while-revalidate=86400",
            },
          },
        ),
      );
    }
  }
  return withCors(NextResponse.json({ error: "Not found" }, { status: 404 }));
}
