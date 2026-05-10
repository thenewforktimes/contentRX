/**
 * /about — "about the model" page.
 *
 * 2026-05-11 rewrite per Robo's audit. The page had drifted out of
 * alignment with the rest of the site (still in the older verbose
 * voice, still leading with abstract framing, still selling sections
 * customers don't care about).
 *
 * Cuts from the prior version:
 *   - "What the model actually reads" — the error-message walkthrough
 *     was clever but not load-bearing for the page's job.
 *   - "Why one designer's judgment" — the rules-vs-judgment frame
 *     repeats from the home page byline. /about doesn't need to
 *     re-argue the moat.
 *   - "Why the model stays honest" — the kappa / override-signal
 *     content folded into the surviving section.
 *   - "attributed and published" from the lede — Robert isn't
 *     publishing or attributing inputs; the calibration log is the
 *     only thing that gets shared, and it's already linked elsewhere.
 *
 * Keeps:
 *   - "How customer interactions improve the model" (rewritten as
 *     "Calibration, not training" — the punchier framing).
 *   - AuthorBlock at the foot.
 *
 * The voice on /about is Robert's first-person voice — this is the
 * trust page where the named-expert moat is explicit. Voice rules:
 * short declarative sentences, no em dashes, no semicolons, no
 * colons.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { AuthorBlock } from "@/components/author-block";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";

export const metadata: Metadata = {
  title: "About the model. ContentRX",
  description:
    "ContentRX is the tool I wish I had when I needed it. The content model a working staff content designer would run on his own writing.",
};

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <PageHeader
        eyebrow="About the model"
        title="The tool I wish I had."
        lede={
          <p>
            ContentRX is the content model a working staff content
            designer would run on his own writing. The standards, the
            context, the weighting system. All of it carries one designer&apos;s judgment calls.
          </p>
        }
      />

      <Section title="Calibration, not training">
        <p>
          When you flag a verdict as wrong, that signal lands in the
          refinement log I read each week. Patterns get curated by
          hand. Training pipelines don&apos;t absorb your strings.
        </p>
        <p className="mt-3">
          Training averages everyone&apos;s strings into a black box.
          Calibration is one editor reading patterns and making
          judgment calls. The model improves because a content
          designer is doing the work, not because your strings became
          someone else&apos;s data.
        </p>
        <p className="mt-3">
          Every Monday the measured accuracy lands on{" "}
          <Link href="/accuracy" className="underline underline-offset-2">
            /accuracy
          </Link>
          {" "}with its 95% confidence interval. The{" "}
          <Link href="/calibration" className="underline underline-offset-2">
            calibration log
          </Link>
          {" "}publishes the movement.
        </p>
      </Section>

      {/* Named-byline closer. The page is "about the model"; the
          model is one designer's judgment. Closing on the byline
          binds the claim to the named author. */}
      <div className="mt-16">
        <AuthorBlock />
      </div>
    </main>
  );
}
