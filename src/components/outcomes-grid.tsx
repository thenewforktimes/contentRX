/**
 * OutcomesGrid — landing page's value-prop spine.
 *
 * Four customer-facing reasons engineering teams pick ContentRX.
 * Time saved on the review loop, cost contained vs a custom-LLM
 * contract, consistency across surfaces, long-form writing handled
 * end-to-end.
 *
 * Visual treatment: editorial 4-up grid, no card chrome. The
 * surrounding sections (SurfacesGrid above, AgentSection below) use
 * bordered surfaces. Dropping the chrome here gives the section a
 * different silhouette so the eye notices it as a different beat.
 *
 * Voice rules tightened 2026-05-10: short declarative sentences. No
 * em dashes. No semicolons. No colons. Cards land at 12-20 words of
 * body each, down from 30-40 in the prior pass. Readers were losing
 * scannability to word-stuffing.
 */

import Link from "next/link";
import { Eyebrow } from "@/components/ui/eyebrow";

type Outcome = {
  /** Single-word eyebrow label so the four-word column scan reads
   * cleanly: Time, Money, Consistency, Long-form. */
  label: string;
  headline: string;
  body: React.ReactNode;
};

const OUTCOMES: readonly Outcome[] = [
  {
    label: "Time",
    headline: "Reviews in seconds, not hours.",
    body: "The read happens where you write. No 'ping me when this is ready'. No second-pass review meeting.",
  },
  {
    label: "Money",
    headline: "One model, one bill.",
    body: "$39/month covers every surface. No Anthropic key. No custom-LLM contract.",
  },
  {
    label: "Consistency",
    headline: "Same call across surfaces.",
    body: "One engine. One set of standards. Same flag in Figma, the LSP, the GitHub Action, and the CLI.",
  },
  {
    label: "Long-form",
    headline: "Long-form, handled.",
    body: (
      <>
        Product updates. Security advisories. Internal announcements.
        Get the full read and a clean rewrite.{" "}
        <Link
          href="/writes"
          className="underline underline-offset-2 hover:text-strong"
        >
          See six worked examples
        </Link>
        .
      </>
    ),
  },
] as const;

export function OutcomesGrid() {
  return (
    <section
      id="outcomes"
      className="mt-16 border-t border-line pt-10 scroll-mt-16"
    >
      <Eyebrow>Outcomes</Eyebrow>
      <h2 className="mt-2 text-2xl font-semibold text-strong sm:text-3xl">
        Why teams pick this.
      </h2>
      <ul className="mt-10 grid grid-cols-1 gap-y-10 sm:grid-cols-2 sm:gap-x-10 lg:grid-cols-4 lg:gap-x-8 lg:divide-x lg:divide-line">
        {OUTCOMES.map((o) => (
          <li
            key={o.label}
            className="flex flex-col lg:px-6 lg:first:pl-0 lg:last:pr-0"
          >
            <Eyebrow>{o.label}</Eyebrow>
            <p className="mt-3 text-base font-semibold text-strong sm:text-lg">
              {o.headline}
            </p>
            <p className="mt-3 text-sm text-default">{o.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
