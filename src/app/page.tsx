/**
 * Landing page — human-eval build plan Session 25.
 *
 * Replaces the Session-0 placeholder with positioning copy structured
 * around the two wedges the plan names:
 *
 *   1. Situation-aware review — ContentRX holds the moment context that
 *      engineers and PMs without content-design training can't hold.
 *   2. Judgment calls — senior-content-designer pattern recognition
 *      encoded, not a rule book.
 *
 * Plus a sharp Grammarly/LanguageTool/Alex contrast, the Stripe Radar
 * frame for "the model IS the product," and links to the accountability
 * surface (/model, /accuracy, /sources, /ethics).
 *
 * Voice note for Robo: this draft is in my voice. Prose is editable;
 * the structure + the five sections matter for the acceptance
 * criterion. Copy that changes the wedge will also need /about edits.
 */

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "ContentRX — the content model for product copy",
  description:
    "Situation-aware review for error states, destructive confirmations, permissions flows, and the other moments where copy stops being decoration and starts being the product.",
};

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <header>
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">
          ContentRX
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
          The content model for product copy.
        </h1>
        <p className="mt-6 text-lg text-neutral-700 dark:text-neutral-300">
          Situation-aware review for the moments where copy stops being
          decoration and starts being the product — error states, empty
          states, permissions flows, destructive confirmations, compliance
          disclosures. A senior content designer&apos;s pattern recognition,
          running where you write: Figma, your CLI, and every pull request.
        </p>
        <div className="mt-8 flex flex-wrap gap-3 text-sm">
          <a
            href="https://www.figma.com/community/plugin/"
            className="rounded-md bg-black px-4 py-2 text-white hover:opacity-90 dark:bg-white dark:text-black"
          >
            Install for Figma
          </a>
          <Link
            href="/model"
            className="rounded-md border border-neutral-300 px-4 py-2 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            See the model
          </Link>
          <Link
            href="/sign-in"
            className="rounded-md border border-transparent px-4 py-2 text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            Sign in →
          </Link>
        </div>
      </header>

      <Section
        eyebrow="Wedge 1"
        title="Situation-aware review"
        body={
          <>
            <p>
              Most UI copy is fine. The stakes are concentrated in a
              handful of moments: an error message that tells the user
              what went wrong and what to do next; a destructive
              confirmation that names the thing being destroyed; a
              permissions button that asks for access instead of
              declaring submission; an empty state that points somewhere
              useful.
            </p>
            <p className="mt-3">
              Engineers and PMs without content-design training can&apos;t
              hold all that context in their heads while they&apos;re
              shipping features. ContentRX holds it for them. It knows
              that the same sentence reads differently in{" "}
              <MomentLink id="destructive_action" /> than in{" "}
              <MomentLink id="browsing_discovery" />, and applies the
              standards that match the moment it detected.
            </p>
          </>
        }
      />

      <Section
        eyebrow="Wedge 2"
        title="Judgment calls, not rule books"
        body={
          <>
            <p>
              A senior content designer looks at an error message and
              sees whether it owns the failure or blames the user.
              That&apos;s not a rule you can look up in a style guide
              — it&apos;s pattern recognition built from years of
              practice. ContentRX encodes that pattern recognition. The{" "}
              <Link href="/model" className="underline underline-offset-2">
                47 standards
              </Link>
              {" "}are the visible surface of it; the{" "}
              <Link href="/model/moments/destructive_action" className="underline underline-offset-2">
                moments
              </Link>
              {" "}carry the situational weights; the evaluation chain
              publishes{" "}
              <Link href="/accuracy" className="underline underline-offset-2">
                its own accuracy
              </Link>
              {" "}with confidence intervals and no composite score.
            </p>
          </>
        }
      />

      <Section
        eyebrow="Sharp contrast"
        title="Not the layer Grammarly / LanguageTool / Alex already cover"
        body={
          <>
            <p>
              Those tools check that your sentence is grammatical and
              inclusive. Excellent at what they do. ContentRX checks a
              different thing: that your error message <em>shouldn&apos;t
              be an error message at all</em>; that your destructive
              confirmation names what will be destroyed; that your
              permissions button says <code>Request access</code> and not{" "}
              <code>Submit</code>.
            </p>
            <p className="mt-3">
              You can run both. The layers don&apos;t compete — they stack.
            </p>
          </>
        }
      />

      <Section
        eyebrow="The Stripe Radar frame"
        title="The model is the product"
        body={
          <>
            <p>
              Stripe Radar is a model. Stripe sells the model — the rules
              engineers write on top are secondary; the learned patterns
              from every transaction Stripe has ever seen are the moat.
            </p>
            <p className="mt-3">
              ContentRX is a model. We sell the model. The{" "}
              <Link href="/model" className="underline underline-offset-2">
                taxonomy
              </Link>
              {" "}is browsable and claimable;{" "}
              <Link href="/sources" className="underline underline-offset-2">
                every source that shaped it
              </Link>
              {" "}is named with its license and opt-out path;{" "}
              <Link href="/accuracy" className="underline underline-offset-2">
                calibration
              </Link>
              {" "}is reported honestly with 95% CIs and no composite
              headline. The rules you can disable per team;{" "}
              <Link href="/ethics" className="underline underline-offset-2">
                the commitments
              </Link>
              {" "}you can&apos;t.
            </p>
          </>
        }
      />

      <Section
        eyebrow="Surfaces"
        title="Runs where you write"
        body={
          <>
            <ul className="ml-5 list-disc space-y-2">
              <li>
                <strong>Figma plugin</strong> — scan a frame,
                per-string verdicts with moment banners and rationale
                chains. Three-button stance per finding (Agree /
                Disagree / Ship anyway).
              </li>
              <li>
                <strong>CLI</strong> —{" "}
                <code>contentrx &quot;Click here&quot;</code> or{" "}
                <code>--batch strings.txt</code>. <code>--explain</code>{" "}
                prints the full rationale chain. Stdlib-only install.
              </li>
              <li>
                <strong>GitHub Action</strong> — evaluates strings touched
                in a PR. <code>fail-on: review</code> gates the merge
                on review-recommended verdicts.
              </li>
              <li>
                <strong>MCP server</strong> — Claude Code, Cursor, and any
                MCP client call <code>evaluate_copy</code>,{" "}
                <code>classify_moment</code>, and the standards catalog
                directly.
              </li>
            </ul>
          </>
        }
      />

      <Section
        eyebrow="About the voice"
        title="Built by a content designer"
        body={
          <>
            <p>
              ContentRX is the content model that Robo — a senior content
              designer — would run on their own work. The moments, the
              weights, the 47 standards: all carry one designer&apos;s
              judgment calls, attributed and published. Read the{" "}
              <Link href="/about" className="underline underline-offset-2">
                about-the-model
              </Link>
              {" "}page for the longer story.
            </p>
          </>
        }
      />

      <footer className="mt-16 border-t border-neutral-200 pt-8 text-sm text-neutral-500 dark:border-neutral-800">
        <p>
          The accountability surface:{" "}
          <Link href="/model" className="underline underline-offset-2">
            /model
          </Link>{" "}
          ·{" "}
          <Link href="/accuracy" className="underline underline-offset-2">
            /accuracy
          </Link>{" "}
          ·{" "}
          <Link href="/sources" className="underline underline-offset-2">
            /sources
          </Link>{" "}
          ·{" "}
          <Link href="/ethics" className="underline underline-offset-2">
            /ethics
          </Link>
          .
        </p>
      </footer>
    </main>
  );
}

function Section({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <section className="mt-16 border-t border-neutral-200 pt-10 first:border-t-0 first:pt-0 dark:border-neutral-800">
      <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">
        {eyebrow}
      </p>
      <h2 className="mt-2 text-2xl font-semibold">{title}</h2>
      <div className="mt-4 text-base text-neutral-700 dark:text-neutral-300">
        {body}
      </div>
    </section>
  );
}

function MomentLink({ id }: { id: string }) {
  return (
    <a
      href={`https://docs.contentrx.io/model/moments/${id}`}
      className="font-mono underline underline-offset-2"
      rel="external noreferrer"
    >
      {id}
    </a>
  );
}
