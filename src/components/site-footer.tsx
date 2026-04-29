/**
 * Site footer — global chrome for marketing + transactional pages.
 *
 * Three columns of links plus a bottom row with copyright, license,
 * and contact. Replaces the inline "accountability surface"
 * mini-footers that lived at the bottom of individual pages
 * (each marketing page used to ship its own variation; now there's
 * one canonical footer the whole public site shares).
 *
 * Column choices:
 *   - Product:  what you can buy / use
 *   - Trust:    accountability surfaces (calibration, sources, ethics)
 *               + privacy/security policies
 *   - Company:  about, status, contact
 *
 * The bottom row carries copyright, the FSL license link, and a
 * contact email. Trademark notice on ContentRX™ aligns with the
 * LICENSE file's claim.
 *
 * Same routing scope as SiteHeader: lives in the (marketing) route
 * group's layout; the dashboard and /admin have their own chrome.
 */

import Link from "next/link";

const productLinks = [
  { href: "/pricing", label: "Pricing" },
  { href: "/install", label: "Install" },
  { href: "/dashboard", label: "Dashboard" },
];

const trustLinks = [
  { href: "/accuracy", label: "Accuracy" },
  { href: "/calibration", label: "Calibration log" },
  { href: "/sources", label: "Sources" },
  { href: "/ethics", label: "Ethics" },
  { href: "/privacy", label: "Privacy" },
  { href: "/security", label: "Security" },
];

const companyLinks = [
  { href: "/about", label: "About" },
  { href: "/status", label: "Status" },
  { href: "mailto:hello@contentrx.io", label: "hello@contentrx.io", external: true as const },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-950">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <div>
            <p className="text-sm font-semibold">ContentRX</p>
            <p className="mt-2 text-xs text-stone-600 dark:text-stone-400">
              The content model for product copy.
            </p>
          </div>
          <FooterColumn title="Product" links={productLinks} />
          <FooterColumn title="Trust" links={trustLinks} />
          <FooterColumn title="Company" links={companyLinks} />
        </div>
        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-stone-200 pt-6 text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
          <p>
            © 2026 Robert Ballard. ContentRX™ is a trademark of Robert Ballard.
          </p>
          <p>
            Source available under{" "}
            <a
              href="https://github.com/thenewforktimes/contentRX/blob/main/LICENSE"
              className="underline underline-offset-2 hover:text-stone-700 dark:hover:text-stone-200"
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
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
        {title}
      </p>
      <ul className="mt-3 space-y-2 text-sm">
        {links.map((link) => (
          <li key={link.href}>
            {link.external ? (
              <a
                href={link.href}
                className="text-stone-700 hover:text-stone-900 dark:text-stone-200 dark:hover:text-stone-50"
              >
                {link.label}
              </a>
            ) : (
              <Link
                href={link.href}
                className="text-stone-700 hover:text-stone-900 dark:text-stone-200 dark:hover:text-stone-50"
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
