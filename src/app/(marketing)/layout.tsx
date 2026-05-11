/**
 * Marketing-route layout.
 *
 * Wraps every public + transactional page (landing, pricing, install,
 * the trust surfaces, status, onboard, join) in the global
 * <SiteHeader> + <SiteFooter>. The route group `(marketing)` is a
 * URL-transparent grouping — pages still live at `/`, `/pricing`,
 * `/ethics`, etc.
 *
 * Why a group instead of putting the chrome in the root layout:
 *   - The dashboard (`(authed)/dashboard/`) has its own header in
 *     its own layout. If global chrome lived in the root layout, the
 *     dashboard would render BOTH chromes stacked.
 *   - The /admin surface deliberately keeps its own dense layout.
 *   - Sign-in / sign-up auth flows render without chrome.
 *
 * Splitting marketing into its own group is the canonical Next.js
 * App Router pattern for "global header on some routes, not others."
 */

import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
