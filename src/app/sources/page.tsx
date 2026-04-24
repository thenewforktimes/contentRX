/**
 * /sources — public attribution surface.
 *
 * Human-eval build plan Session 14 ships this as a stub. Session 19
 * populates it from the consolidated attribution metadata (Session
 * 16's extended `sources` fields on standards + Session 15's external
 * signal tracking).
 *
 * The stub matters because `/ethics` links here — a working link that
 * says "coming soon" is better than a 404 that undermines the ethics
 * page's transparency commitment on day one.
 */

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Sources — ContentRX",
  description:
    "Every design system, style guide, and OSS repo ContentRX has ingested, with last-crawl timestamps and license information.",
};

export default function SourcesPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <header className="mb-10">
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">
          Attribution surface
        </p>
        <h1 className="mt-3 text-3xl font-semibold">Sources</h1>
        <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
          Every public source that has informed ContentRX — design
          systems, style guides, OSS repos — will appear here with its
          last-crawl timestamp, license, and role (moment weights,
          standard influences, examples corpus, or training signal).
          The list is the accountability surface for{" "}
          <Link href="/ethics" className="underline underline-offset-2">
            /ethics
          </Link>
          &apos;s transparency commitment.
        </p>
      </header>

      <section className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-6 text-sm text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
        <p>
          <strong>This page is under construction.</strong> The
          automated generator lands with a later session — until then,
          the committed list of per-standard source attributions lives
          in{" "}
          <a
            href="https://github.com/thenewforktimes/contentRX/blob/main/src/content_checker/standards/standards_library.json"
            className="underline underline-offset-2"
          >
            <code className="font-mono">standards_library.json</code>
          </a>{" "}
          under each standard&apos;s <code className="font-mono">sources</code>{" "}
          field, and the design-system inspirations for moment weights
          are documented in the{" "}
          <a
            href="https://github.com/thenewforktimes/contentRX/blob/main/src/content_checker/moments.py"
            className="underline underline-offset-2"
          >
            <code className="font-mono">moments.py</code>
          </a>{" "}
          module docstring.
        </p>
        <p className="mt-3">
          To opt out of future inclusion — or to correct an attribution
          that&apos;s already here — email{" "}
          <a
            href="mailto:hello@contentrx.io?subject=%5BOPTOUT%5D+%3Csource+name%3E"
            className="underline underline-offset-2"
          >
            hello@contentrx.io
          </a>
          . See{" "}
          <Link href="/ethics" className="underline underline-offset-2">
            /ethics
          </Link>{" "}
          for the opt-out process.
        </p>
      </section>

      <footer className="mt-16 text-xs text-neutral-500">
        <p>
          Last updated 2026-04-23. Stub — populated by human-eval build
          plan Session 19.
        </p>
      </footer>
    </main>
  );
}
