import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ContentRX — content design linter for Figma and code",
  description:
    "A content standards checker that runs in Figma, your CLI, and your CI pipeline. Moment-aware, rule-cited, open source.",
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
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
