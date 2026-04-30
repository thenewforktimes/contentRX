import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isProtected = createRouteMatcher([
  "/dashboard(.*)",
  "/api/check(.*)",
  "/api/classify(.*)",
  "/api/dashboard(.*)",
  "/api/team-rules(.*)",
  "/api/team-analytics(.*)",
  "/api/integrations/(.*)",
  "/api/portal(.*)",
  "/api/checkout(.*)",
  "/api/violations/(.*)",
]);

// Routes whose own handler validates a ContentRX Bearer token (cx_...) in
// addition to accepting Clerk sessions. Clerk's auth.protect() does not
// recognize our API keys, so we must let these requests pass through to
// the handler and let resolveAuth() in src/lib/auth.ts make the call.
const acceptsApiKey = createRouteMatcher([
  "/api/check(.*)",
  "/api/classify(.*)",
  "/api/team-rules(.*)",
  "/api/team-analytics(.*)",
  "/api/integrations/(.*)",
  "/api/violations/(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isProtected(req)) return;

  // CORS preflight requests never carry auth headers; browsers will strip
  // them. Letting OPTIONS through avoids a 401 that breaks the plugin.
  if (req.method === "OPTIONS") return;

  const authHeader = req.headers.get("authorization");
  if (
    acceptsApiKey(req) &&
    authHeader &&
    /^Bearer\s+cx_/i.test(authHeader)
  ) {
    return;
  }

  // Differentiate API routes from page routes when auth is missing.
  // `auth.protect()` defaults to `notFound()` (HTML 404), which is
  // confusing for both audiences:
  //   - Pages: a customer typing /dashboard or following a stale link
  //     sees "this page doesn't exist" instead of a sign-in prompt.
  //   - APIs: an integrator's CLI/curl client gets HTML at a JSON
  //     endpoint, breaks parsing, makes the failure mode opaque.
  // Branching here gives each audience the response they expect.
  const { userId } = await auth();
  if (userId) return;

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const signInUrl = new URL("/sign-in", req.url);
  signInUrl.searchParams.set(
    "redirect_url",
    req.nextUrl.pathname + req.nextUrl.search,
  );
  return NextResponse.redirect(signInUrl);
});

export const config = {
  matcher: [
    // Skip static files (_next, file extensions, /.well-known/), the
    // public health probe (api/status — uptime monitors hit it on a
    // tight schedule), and routes that verify their own signatures
    // (api/webhooks, api/cron) or are gated by INTERNAL_EVAL_SECRET
    // (api/evaluate). Skipping clerk middleware on these saves the
    // auth-resolution cost on every probe + every webhook delivery.
    "/((?!_next|\\.well-known/|api/(?:webhooks|cron|evaluate|status)|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/trpc(.*)",
  ],
};
