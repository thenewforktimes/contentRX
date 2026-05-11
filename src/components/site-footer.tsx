/**
 * Site footer — global chrome for marketing + transactional pages.
 *
 * Four columns of links plus a bottom row with copyright, the DBA
 * disclosure, license, and contact. Replaces the inline
 * "accountability surface" mini-footers that lived at the bottom of
 * individual pages (each marketing page used to ship its own
 * variation; now there's one canonical footer the whole public site
 * shares).
 *
 * Column choices:
 *   - Product:  what you can buy / use
 *   - Trust:    accountability surfaces (accuracy, calibration, ethics)
 *               + privacy/security policies
 *   - Legal:    the binding contract documents (Terms + Privacy).
 *               Privacy appears in both Trust and Legal — it's an
 *               accountability surface AND a legal doc. This mirrors
 *               Ditto's footer pattern (a dedicated Legal column).
 *   - Company:  status, contact
 *
 * The bottom row carries copyright, the DBA disclosure (Abstract
 * Nonsense LLC dba ContentRX — exact wording pending attorney
 * confirmation in Phase B), the FSL license link, and a contact
 * email. Trademark notice on ContentRX™ aligns with the LICENSE
 * file's claim.
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

const trustLinks = [
  { href: "/accuracy", label: "Accuracy" },
  { href: "/calibration", label: "Calibration log" },
  { href: "/ethics", label: "Ethics" },
  { href: "/privacy", label: "Privacy" },
  { href: "/security", label: "Security" },
];

const legalLinks = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
];

const companyLinks = [
  { href: "/status", label: "Status" },
  { href: "mailto:hello@contentrx.io", label: "hello@contentrx.io", external: true as const },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-sunken">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-5">
          <div>
            <Wordmark size="sm" link={false} />
            <p className="mt-2 text-xs text-quiet">
              The content model for product writing.
            </p>
          </div>
          <FooterColumn title="Product" links={productLinks} />
          <FooterColumn title="Trust" links={trustLinks} />
          <FooterColumn title="Legal" links={legalLinks} />
          <FooterColumn title="Company" links={companyLinks} />
        </div>
        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6 text-xs text-quiet">
          <p>
            {/*
              DBA disclosure stub — Phase B replaces with the exact
              attorney-confirmed wording. Likely shapes:
                "ContentRX is a service of Abstract Nonsense LLC."
                "© 2026 Abstract Nonsense LLC dba ContentRX."
              Trademark line stays separate because the mark is
              registered to Robert Ballard personally, not the LLC.
            */}
            © 2026 Robert Ballard. ContentRX is a service of Abstract
            Nonsense LLC. ContentRX™ is a trademark of Robert Ballard.
          </p>
          <p>
            Source available under{" "}
            <a
              href="https://github.com/thenewforktimes/contentRX/blob/main/LICENSE"
              className="underline underline-offset-2 hover:text-default"
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
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-quiet">
        {title}
      </p>
      <ul className="mt-3 space-y-2 text-sm">
        {links.map((link) => (
          <li key={link.href}>
            {link.external ? (
              <a
                href={link.href}
                className="text-quiet hover:text-strong"
              >
                {link.label}
              </a>
            ) : (
              <Link
                href={link.href}
                className="text-quiet hover:text-strong"
              >
                {link.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
