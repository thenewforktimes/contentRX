import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";

// Inter is the body-reading font — designed by Rasmus Andersson
// specifically for screen readability at body sizes (13–16px). Wide
// apertures and open counters give the same easy-on-the-eyes feel
// as a Kindle Paperwhite while keeping the modern SaaS aesthetic.
// Geist Sans (the previous default) is geometric + slightly condensed
// — beautiful for display but fights you at body sizes.
const inter = Inter({
  variable: "--font-sans-base",
  subsets: ["latin"],
});

// Geist Mono stays — it's actually great at code, IDs, hashes, and
// timestamps. The font-mono token in @theme inline points here.
const geistMono = Geist_Mono({
  variable: "--font-mono-base",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ContentRX. The opinionated editor for the prose in your codebase.",
  description:
    "The opinionated editor for the prose that lives in your codebase. Error messages, READMEs, API docs, PR and commit copy, held to one editorial standard before merge. Runs in Claude Code, Cursor, your CLI, and CI.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Plausible is just a script tag — the site is identified by data-domain.
  // No-op when NEXT_PUBLIC_PLAUSIBLE_DOMAIN is unset (dev / preview).
  //
  // ClerkProvider lives in `(authed)/layout.tsx` so marketing pages
  // don't pay for Clerk's frontend SDK. Audit Pf5.
  const plausibleDomain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${geistMono.variable} antialiased`}
      >
        {/*
         * Skip-to-content link (WCAG 2.4.1 Bypass Blocks). Visually
         * hidden until focused; appears as a focus-ring pill in the
         * top-left for keyboard users. Targets `#main-content`,
         * which every page-level <main> sets via id+tabIndex={-1}
         * so focus actually lands inside the content rather than
         * just scrolling.
         *
         * Required because every page renders the same chrome
         * (Wordmark + 4-12 nav links) before reaching content; a
         * keyboard user otherwise tabs through that chrome on every
         * navigation. With this link, the first Tab on any page
         * surfaces "Skip to content" and one keypress lands focus
         * in the body.
         */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent-primary-solid focus:px-4 focus:py-2 focus:text-accent-primary-on focus:shadow-lg focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-canvas"
        >
          Skip to content
        </a>
        {children}
        {plausibleDomain && (
          <Script
            defer
            data-domain={plausibleDomain}
            src="https://plausible.io/js/script.outbound-links.js"
            strategy="lazyOnload"
          />
        )}
      </body>
    </html>
  );
}
