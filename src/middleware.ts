import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

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

  await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
