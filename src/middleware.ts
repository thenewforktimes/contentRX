import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const isProtected = createRouteMatcher([
  "/dashboard(.*)",
  "/admin(.*)",
  "/api/check(.*)",
  "/api/classify(.*)",
  "/api/dashboard(.*)",
  "/api/team-rules(.*)",
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
  "/api/violations/(.*)",
]);

// Geo-block scope (2026-05-12 launch decision):
//   - Allowed: United States + U.S. territories + Canada except Quebec.
//   - Quebec is geo-blocked specifically because Quebec Law 25 has
//     operational requirements (French-language notice, in-province
//     privacy officer, automated-decision PIAs) that ContentRX has not
//     built coverage for yet.
//   - EU/EEA/UK are geo-blocked until an Article 27 representative is
//     appointed.
// The country/region values come from Vercel edge headers (Next.js 15
// removed req.geo). In local dev or self-hosted deployments where these
// headers are absent, the geo check no-ops (allow) so localhost works.
const ALLOWED_COUNTRIES = new Set([
  "US", // United States
  "PR", // Puerto Rico
  "VI", // U.S. Virgin Islands
  "GU", // Guam
  "AS", // American Samoa
  "MP", // Northern Mariana Islands
  "UM", // U.S. Minor Outlying Islands
  "CA", // Canada (Quebec excluded below by region check)
]);
const QUEBEC_REGION = "QC";

// Paths that bypass the geo-block entirely. These are legal-transparency
// and waitlist-funnel surfaces. /sign-in is included so returning
// customers from blocked regions can still log into the account they
// created when they were in an allowed region — once they have a Clerk
// session, the geo-block doesn't run anyway, but the sign-in page
// itself has to be reachable.
const isAlwaysAllowed = createRouteMatcher([
  "/waitlist(.*)",
  "/api/waitlist(.*)",
  "/privacy(.*)",
  "/terms(.*)",
  "/ethics(.*)",
  "/disclaimer(.*)",
  "/security(.*)",
  "/accuracy(.*)",
  "/legal/(.*)",
  "/sign-in(.*)",
]);

function checkGeoBlock(req: NextRequest): NextResponse | null {
  const country = req.headers.get("x-vercel-ip-country") ?? "";
  const region = req.headers.get("x-vercel-ip-country-region") ?? "";

  // No country header = local dev, self-hosted, or non-Vercel deploy.
  // Don't enforce geo when we have no signal. Production traffic
  // through Vercel's edge always carries this header.
  if (!country) return null;

  const isQuebec = country === "CA" && region === QUEBEC_REGION;
  const isAllowed = !isQuebec && ALLOWED_COUNTRIES.has(country);
  if (isAllowed) return null;

  // For API routes, return 451 Unavailable For Legal Reasons with a
  // JSON body. A redirect to /waitlist on an API endpoint would break
  // any client that follows redirects automatically and lands on HTML.
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        error: "Service not available in your region",
        waitlist_url: new URL("/waitlist", req.url).toString(),
      },
      { status: 451 },
    );
  }

  // For page routes, redirect to /waitlist with the detected region
  // captured as a query param. The waitlist page reads this to
  // personalise the message ("ContentRX will email you when [region]
  // opens").
  const waitlistUrl = new URL("/waitlist", req.url);
  const regionTag = region ? `${country}-${region}` : country;
  waitlistUrl.searchParams.set("region", regionTag);
  return NextResponse.redirect(waitlistUrl);
}

export default clerkMiddleware(async (auth, req) => {
  // Always-allow paths skip geo + auth checks entirely. Legal pages,
  // the waitlist itself, the DPA download, and the sign-in page must
  // be reachable from any region.
  if (isAlwaysAllowed(req)) return;

  // CORS preflight requests never carry auth headers; browsers will
  // strip them. Letting OPTIONS through avoids a 401 that breaks the
  // plugin. Pre-empts both the geo-block and the auth check.
  if (req.method === "OPTIONS") return;

  // Resolve auth state once. Used to skip the geo-block for already
  // authenticated users (they signed up when they were in an allowed
  // region; they can travel) and to short-circuit the protected-route
  // auth fallback below.
  const { userId } = await auth();
  const authHeader = req.headers.get("authorization");
  // Audit L1 (2026-05-13): match the full well-formed shape
  // (`cx_` + ≥16 alphanumeric chars), not just the `cx_` prefix.
  // Inlined regex rather than importing isWellFormedApiKey from
  // src/lib/api-key.ts because that module pulls `node:crypto`,
  // which doesn't ship in the edge middleware runtime. Pattern must
  // stay in sync with `API_KEY_REGEX` in src/lib/api-key.ts. The
  // previous prefix-only check let `Authorization: Bearer cx_`
  // (without a body) bypass the geo-block on public pages — auth
  // still failed downstream on protected routes, but the bypass
  // intent was sidestepped for marketing pages.
  const hasApiKey = !!(
    authHeader && /^Bearer\s+cx_[A-Za-z0-9]{16,}\s*$/i.test(authHeader)
  );
  const isAuthenticated = !!userId || hasApiKey;

  // Geo block applies only to unauthenticated visitors. The whole
  // point is to gate new signups from blocked regions — existing
  // customers should keep working from anywhere.
  if (!isAuthenticated) {
    const blocked = checkGeoBlock(req);
    if (blocked) return blocked;
  }

  // Below here is the original protected-route enforcement, unchanged.
  if (!isProtected(req)) return;

  // Bearer cx_ on an API-key-accepting route: let the handler call
  // resolveAuth() rather than forcing a Clerk session here.
  if (acceptsApiKey(req) && hasApiKey) return;

  // Clerk session present: pass through.
  if (userId) return;

  // Differentiate API routes from page routes when auth is missing.
  // `auth.protect()` defaults to `notFound()` (HTML 404), which is
  // confusing for both audiences:
  //   - Pages: a customer typing /dashboard or following a stale link
  //     sees "this page doesn't exist" instead of a sign-in prompt.
  //   - APIs: an integrator's CLI/curl client gets HTML at a JSON
  //     endpoint, breaks parsing, makes the failure mode opaque.
  // Branching here gives each audience the response they expect.
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
    // The pdf extension is added so /legal/dpa.pdf and any other
    // public PDF asset bypasses middleware entirely (it would
    // otherwise be subject to the geo-block; legal docs must remain
    // globally accessible).
    "/((?!_next|\\.well-known/|api/(?:webhooks|cron|evaluate|status)|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|pdf|zip|webmanifest)).*)",
    "/trpc(.*)",
  ],
};
