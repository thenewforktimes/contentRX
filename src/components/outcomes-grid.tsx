/**
 * OutcomesGrid — landing page's value-prop spine.
 *
 * Four customer-facing outcomes ContentRX commits to: time saved on
 * the review loop, cost contained vs a custom-LLM contract,
 * consistency across surfaces, and long-form writing handled
 * end-to-end. These are the questions a skeptical engineering team
 * scans for first; they were missing from the landing's lower half,
 * which read as procurement-and-commitments without surfacing the
 * outcome story.
 *
 * Visual treatment: editorial 4-up grid, no card chrome. The
 * surrounding sections (SurfacesGrid above, Weekly review agent +
 * Built-for-stack below) all use bordered cards. Dropping the chrome
 * here gives the section a different silhouette so the eye notices
 * it as a different kind of beat. The vertical rules (border-y on
 * the list, divide-x between columns at lg+) stand in for the
 * card borders without enclosing each item.
 *
 * The eyebrow label on each item names the value (Time / Money /
 * Consistency / Long-form). A reader scanning the labels column-down
 * gets the four-word version of the page before reading any body
 * copy.
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
    body: "The staff-content-designer read happens in the surface the writing is happening in. No 'ping me when this is ready,' no second-pass review meeting on the calendar.",
  },
  {
    label: "Money",
    headline: "One model, one bill.",
    body: "$39 a month covers MCP, LSP, CLI, GitHub Action, Figma plugin, and the dashboard. No Anthropic key. No custom-LLM contract. No per-team prompt to maintain.",
  },
  {
    label: "Consistency",
    headline: "Same call across surfaces.",
    body: "The standard that flags 'Submit' in the Figma plugin flags it the same way in the GitHub Action, the LSP, and the CLI. Same engine. Same precedents. The customer reads one team.",
  },
  {
    label: "Long-form",
    headline: "Document-level read, not just per-string flags.",
    body: (
      <>
        Paste a product update, a security advisory, an internal
        announcement. Get the document-level diagnostic, a clean
        rewrite, and the reasoning.{" "}
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
      <Eyebrow>What teams ship with this</Eyebrow>
      <h2 className="mt-2 text-2xl font-semibold text-strong sm:text-3xl">
        Faster reviews. One bill. Consistent across surfaces. Long-form handled.
      </h2>
      <p className="mt-4 max-w-2xl text-base text-default">
        The four outcomes ContentRX commits to. Each one is an
        engineering team&apos;s reason for picking it over a Claude
        wrapper or a per-team prompt.
      </p>
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
