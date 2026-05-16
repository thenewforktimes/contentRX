/**
 * Layout for routes that need Clerk's React context.
 *
 * Audit Pf5 — pre-split, ClerkProvider lived in the root layout, so
 * the marketing pages all paid for Clerk's frontend SDK in their
 * shared bundle. Splitting it here means /, /pricing, /install,
 * /writes, /accuracy, /ethics — none of which use Clerk on the
 * client — drop the dependency from their First Load JS. (/calibration
 * retired 2026-05-11; /writes added 2026-05-09.)
 *
 * Routes inside this group (URL paths preserved by the route-group
 * naming convention):
 *
 *   /dashboard, /sign-in, /sign-up
 *
 * Server-side `auth()` works regardless of provider placement (it
 * reads the cookie via middleware), so /admin, /onboard, and /join
 * can stay at the root layout — they call `auth()` from the server
 * but never render a Clerk client component.
 */

import { ClerkProvider } from "@clerk/nextjs";

export default function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/dashboard"
    >
      {children}
    </ClerkProvider>
  );
}
