/**
 * PageHeader — the single owner of every public page's top block.
 *
 * Before this primitive existed, every page in `(marketing)` inlined its
 * own variant of:
 *
 *   <header className="mb-12 (or mb-10)">
 *     <Eyebrow>...</Eyebrow>          (or raw <p className="text-xs..."> on
 *                                      /accuracy, /calibration, /ethics)
 *     <h1 className="mt-3 (or mt-2) text-3xl (or text-3xl sm:text-4xl)
 *                    font-semibold ...">...</h1>
 *     <p className="mt-4 text-lg text-default">...</p>
 *     <p className="mt-3 text-sm (or text-xs) text-quiet">...</p>
 *   </header>
 *
 * The drift was small per-page but obvious in aggregate: spacing varied
 * by 1-2 Tailwind steps, the eyebrow was sometimes raw HTML instead of
 * the <Eyebrow> primitive, the heading scale was mostly text-3xl with
 * a few text-3xl sm:text-4xl outliers. After landing's display-tier
 * refresh (PRs #370/#371/#372), the rest of the site read as quiet by
 * comparison.
 *
 * This primitive locks the rhythm. Two scales:
 *
 *   page (default)   — text-4xl sm:text-5xl, font-bold
 *                      For trust pages, install, sources, calibration,
 *                      accuracy. Standard authoritative page heading.
 *
 *   display          — text-5xl sm:text-6xl lg:text-7xl, font-bold
 *                      For commercial pages where the header has to
 *                      land alongside the landing's hero. Pricing
 *                      uses this; future product-tier pages would too.
 *                      Landing is its own thing — has the wordmark,
 *                      doesn't use PageHeader.
 *
 * 2026-05-10 display-type bump: prior values were `text-3xl sm:text-4xl`
 * (page) and `text-4xl sm:text-5xl lg:text-6xl` (display) at
 * `font-semibold`. The marketing surfaces read reserved next to peers
 * who commit harder to display type (Ditto, Linear, Vercel). Bumped
 * one Tailwind step at every breakpoint and shifted weight from 600 to
 * 700. No tokens changed — same colors, same tracking, just bigger and
 * heavier. Dashboard h1s use the `<Heading>` primitive (text-2xl), so
 * panel headers are unaffected.
 *
 * Slots: `lede` (the supporting paragraph), `meta` (smaller text after
 * the lede, e.g. "Snapshot generated 2026-05-06" or "Effective date").
 * Both optional. Both render at consistent sizes/colors so the page
 * doesn't have to make those decisions again.
 *
 * Canvas width is the caller's job — `<main className="max-w-2xl">`
 * vs `max-w-6xl` is a per-page decision (reading column vs product
 * page). PageHeader sits inside whatever the page sets.
 */

import type { ReactNode } from "react";
import { Eyebrow } from "./eyebrow";

type PageHeaderScale = "page" | "display";

const titleClasses: Record<PageHeaderScale, string> = {
  page: "text-4xl font-bold tracking-tight text-strong sm:text-5xl",
  display:
    "text-5xl font-bold tracking-tight text-strong sm:text-6xl lg:text-7xl",
};

export function PageHeader({
  eyebrow,
  eyebrowHighlight = false,
  title,
  lede,
  meta,
  scale = "page",
  id,
  className = "",
  children,
}: {
  /** Small uppercase tracking-widest label above the heading. Optional;
   * /accuracy and /calibration historically didn't render one. */
  eyebrow?: string;
  /** When true, render the eyebrow with the soft-caution marker-pen
   * treatment (see `<Eyebrow highlight>`). Off by default so existing
   * pages stay unchanged. Use on commercial pages where a flash of
   * personality earns its keep. */
  eyebrowHighlight?: boolean;
  /** The page's H1. */
  title: string;
  /** Optional supporting paragraph immediately below the heading. */
  lede?: ReactNode;
  /** Optional smaller text after the lede — generated-at timestamps,
   * effective dates, "see also" pointers. Renders at `text-sm
   * text-quiet`. */
  meta?: ReactNode;
  /** Heading scale — default `page`. Use `display` for commercial /
   * product-tier pages (currently /pricing). */
  scale?: PageHeaderScale;
  /** HTML id forwarded to the <header> for in-page anchors. */
  id?: string;
  /** Extra utility classes appended to the <header> element. */
  className?: string;
  /** Trailing content rendered inside the <header> after meta — e.g.
   * /install's per-surface chip nav. The header's bottom margin still
   * applies. Style your own spacing inside (commonly `mt-6`). */
  children?: ReactNode;
}) {
  return (
    <header id={id} className={`mb-12 ${className}`.trim()}>
      {eyebrow && <Eyebrow highlight={eyebrowHighlight}>{eyebrow}</Eyebrow>}
      <h1 className={`${eyebrow ? "mt-3 " : ""}${titleClasses[scale]}`}>
        {title}
      </h1>
      {lede && (
        <div className="mt-4 text-lg text-default">{lede}</div>
      )}
      {meta && (
        <div className="mt-3 text-sm text-quiet">{meta}</div>
      )}
      {children}
    </header>
  );
}
