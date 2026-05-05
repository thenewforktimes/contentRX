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
  title: "ContentRX. The content model for product copy",
  description:
    "Staff-level content design review for the copy that decides whether the product works: error states, destructive confirmations, permissions flows, empty states. Runs in Claude Code, Cursor, your CLI, your CI, and Figma.",
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
