/**
 * Site footer — global chrome for marketing + transactional pages.
 *
 * Four columns of links plus a bottom row with copyright, the entity
 * disclosure, and the FSL license link. Replaces the inline
 * "accountability surface" mini-footers that lived at the bottom of
 * individual pages (each marketing page used to ship its own
 * variation; now there's one canonical footer the whole public site
 * shares).
 *
 * Column choices:
 *   - Product:  what you can buy / use
 *   - Trust:    accountability surfaces (accuracy, calibration, ethics)
 *               + privacy/security policies
 *   - Legal:    the binding contract documents (Terms + Privacy +
 *               Disclaimer). Privacy appears in both Trust and Legal,
 *               which is intentional — it's an accountability surface
 *               AND a legal doc. Mirrors Ditto's footer pattern (a
 *               dedicated Legal column).
 *   - Company:  status, contact
 *
 * The bottom row carries copyright, the entity disclosure (ContentRX
 * LLC, a California limited liability company), and the FSL license
 * link. Trademark notice on ContentRX™ tracks the LICENSE file's
 * claim and is on the LLC rather than Robert personally now that the
 * LLC exists as the operating entity (2026-05-12 pivot from the
 * earlier Abstract Nonsense LLC dba ContentRX plan to a separate
 * ContentRX LLC).
 *
 * Same routing scope as SiteHeader: lives in the (marketing) route
 * group's layout; the dashboard and /admin have their own chrome.
 */

import Link from "next/link";
import { Wordmark } from "@/components/wordmark";

const productLinks = [
  { href: "/pricing", label: "Pricing" },
  { href: "/install", label: "Install" },
  { href: "/dashboard", label: "Dashboard" },
];

// Trust column order (2026-05-11 Robo): Ethics → Privacy → Security
// → Accuracy. Position-by-trust-shape, not alphabetical: ethics is
// the position-level commitment, privacy and security are the
// contracts that fall out of it, accuracy is the measurement that
// proves it. Calibration log folded into /accuracy as a section —
// no separate trust link.
const trustLinks = [
  { href: "/ethics", label: "Ethics" },
  { href: "/privacy", label: "Privacy" },
  { href: "/security", label: "Security" },
  { href: "/accuracy", label: "Accuracy" },
];

const legalLinks = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/disclaimer", label: "Disclaimer" },
];

const companyLinks = [
  { href: "/status", label: "Status" },
  { href: "mailto:hello@contentrx.io", label: "hello@contentrx.io", external: true as const },
];

/**
 * `contentMaxWidth` lets the parent layout match the footer's inner
 * content width to the page above it. The footer's full-width
 * border-top is unaffected (it always spans the viewport). Default
 * `max-w-5xl` matches the marketing pages; the dashboard (max-w-3xl
 * content) passes `max-w-3xl` so the footer columns line up with the
 * page chrome instead of breaking the rhythm at the bottom of the
 * viewport.
 */
type SiteFooterProps = {
  contentMaxWidth?: string;
};

export function SiteFooter({
  contentMaxWidth = "max-w-5xl",
}: SiteFooterProps = {}) {
  return (
    <footer className="border-t border-line bg-sunken">
      <div className={`mx-auto px-6 py-10 ${contentMaxWidth}`}>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-5">
          <div>
            <Wordmark size="xs" />
            <p className="mt-2 text-xs text-quiet">
              The opinionated editor for the prose in your codebase.
            </p>
          </div>
          <FooterColumn title="Product" links={productLinks} />
          <FooterColumn title="Trust" links={trustLinks} />
          <FooterColumn title="Legal" links={legalLinks} />
          <FooterColumn title="Company" links={companyLinks} />
        </div>
        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6 text-xs text-quiet">
          <p>
            © 2026 ContentRX LLC. A California limited liability
            company. ContentRX™ is a trademark of ContentRX LLC.
          </p>
          <p>
            Source available under{" "}
            <a
              href="https://github.com/thenewforktimes/contentRX/blob/main/LICENSE"
              // visited locked to quiet so the link doesn't drop to
              // browser-default purple on the sunken footer surface.
              // focus-visible ring matches the FooterColumn pattern
              // — bottom-row anchor was missed in the original sweep.
              // WCAG 2.4.7 + 1.4.3.
              className="rounded underline underline-offset-2 visited:text-quiet hover:text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sunken"
            >
              FSL-1.1-MIT
            </a>
            .
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: ReadonlyArray<{ href: string; label: string; external?: true }>;
}) {
  // Each column is a navigation landmark (WCAG 1.3.1, 2.4.6). The
  // column title is an <h2> so screen-reader users can heading-jump
  // between footer sections. Links wear the design-system focus ring
  // explicitly (the bg-sunken background hides the browser default).
  return (
    <nav aria-label={title}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-quiet">
        {title}
      </h2>
      <ul className="mt-3 space-y-2 text-sm">
        {links.map((link) => (
          <li key={link.href}>
            {link.external ? (
              <a
                href={link.href}
                className="rounded text-quiet visited:text-quiet hover:text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sunken"
              >
                {link.label}
              </a>
            ) : (
              <Link
                href={link.href}
                className="rounded text-quiet visited:text-quiet hover:text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sunken"
              >
                {link.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
