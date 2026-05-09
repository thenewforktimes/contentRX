/**
 * /writes — long-form gallery scaffold (Phase F3a, 2026-05-09 roadmap).
 *
 * Three examples on day 1 (product update, security advisory, internal
 * announcement). F3b lands the next three (all-hands email, incident
 * status comm, policy notice). The data array below is the seam — F3b
 * appends, doesn't restructure.
 *
 * Each example renders the writer's draft, the engine's flags, and the
 * suggested rewrite. Substrate-clean (ADR 2026-04-25): customer-facing
 * vocabulary only, no `standard_id`, no `rule_version`, no engine
 * snake_case enums leak through.
 *
 * Voice: calm, confident, charming per docs/copy-vocabulary.md. The
 * draft inputs deliberately demonstrate corporate / hedged / cloying
 * writing so the suggestions can land their fixes; they aren't the
 * product's voice, they're the writing the product flags.
 */

import type { Metadata } from "next";
import { Eyebrow } from "@/components/ui/eyebrow";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";

export const metadata: Metadata = {
  title: "Long-form writing review. ContentRX",
  description:
    "ContentRX reviews the longer-form writing your team sends to itself. Product updates, security advisories, internal announcements. Same engine, same content-design judgment, on the writing the inbox sees.",
};

type Flag = {
  category: string;
  severity: "high" | "medium" | "low";
  severityLabel: string;
  issue: string;
  suggestion: string;
};

type Example = {
  id: string;
  label: string;
  momentLabel: string;
  contentTypeLabel: string;
  intro: string;
  inputText: string;
  flags: readonly Flag[];
  rewrite: string;
};

const EXAMPLES: readonly Example[] = [
  {
    id: "product-update",
    label: "Product update",
    momentLabel: "Customer notification",
    contentTypeLabel: "Long-form",
    intro:
      "An email going out to existing customers about a shipped feature. The most common kind of long-form your team writes; also the most consistently jargon-heavy.",
    inputText:
      "Hi team! We're absolutely thrilled to announce our newest feature, advanced moment classification. This robust capability leverages cutting-edge AI to facilitate your team's ability to optimize content workflows. The intuitive new dashboard streamlines the review paradigm, empowering you to ideate across departments. We can't wait to see how you'll utilize these world-class enhancements!",
    flags: [
      {
        category: "Plain language",
        severity: "medium",
        severityLabel: "Worth adjusting",
        issue:
          "Eleven corporate words land in four sentences (robust, leverages, facilitate, optimize, intuitive, streamlines, paradigm, empowering, ideate, utilize, world-class, cutting-edge). The reader translates the announcement before they read it.",
        suggestion:
          "Replace with plain words. 'Use' beats 'utilize'; 'help' beats 'facilitate'; 'improve' beats 'optimize'.",
      },
      {
        category: "Voice & tone",
        severity: "medium",
        severityLabel: "Worth adjusting",
        issue:
          "Three exclamation points in four sentences. The energy reads as handled, not informed.",
        suggestion:
          "Cut to zero. The product update is news; news doesn't need exclaiming.",
      },
      {
        category: "Active voice",
        severity: "low",
        severityLabel: "Quick polish",
        issue:
          "'The dashboard streamlines the paradigm' hides who built what. Name the team behind the work.",
        suggestion:
          "'We rebuilt the dashboard so the moment classifier runs on every check.' carries the actor; the original sentence hides it.",
      },
    ],
    rewrite:
      "Hi team. We shipped advanced moment classification. The dashboard now picks the right register for the kind of writing being reviewed: error message, product email, security disclosure, marketing post. The flag list adapts to match. Same dashboard URL. The rest of your workflow doesn't change.",
  },
  {
    id: "security-advisory",
    label: "Security advisory",
    momentLabel: "Compliance disclosure",
    contentTypeLabel: "Long-form",
    intro:
      "A disclosure email to affected users after a security event. The bar is highest here. The reader needs to know what was exposed, who was affected, and what to do.",
    inputText:
      "On April 12, 2026, our security team became aware of a potential vulnerability that may have impacted some users. We have since taken comprehensive steps to mitigate this issue and ensure the integrity of our platform. We sincerely apologize for any inconvenience this may have caused. Please reach out to our team if you have any questions or concerns regarding this matter.",
    flags: [
      {
        category: "Voice & tone",
        severity: "high",
        severityLabel: "Worth adjusting",
        issue:
          "The reader doesn't know what was exposed, who was affected, or what to do. A disclosure has to name those three things or it isn't a disclosure.",
        suggestion:
          "Name the data class (email addresses, payment data, content). Name the affected count. Name the next step.",
      },
      {
        category: "Plain language",
        severity: "medium",
        severityLabel: "Worth adjusting",
        issue:
          "'Comprehensive steps to mitigate this issue and ensure the integrity of our platform' is corporate filler. The reader wants the verbs.",
        suggestion:
          "Replace with the specific actions. 'Rotated sessions, emailed affected users, audited the access path.'",
      },
      {
        category: "Voice & tone",
        severity: "low",
        severityLabel: "Quick polish",
        issue:
          "'We sincerely apologize for any inconvenience' performs concern instead of stating the work.",
        suggestion:
          "Drop the apology line. The reader's concern is the data, not the reassurance.",
      },
    ],
    rewrite:
      "On April 12, 2026, an attacker accessed email addresses for 1,200 accounts. No passwords, payment data, or content were exposed. We rotated affected sessions and emailed every affected user on April 13th. If you didn't get an email, you weren't affected. Questions: security@contentrx.io.",
  },
  {
    id: "internal-announcement",
    label: "Internal announcement",
    momentLabel: "Team notification",
    contentTypeLabel: "Long-form",
    intro:
      "A casual heads-up to teammates. The register is more relaxed than a customer email; the standards aren't.",
    inputText:
      "Hey everyone! Quick heads up that the all hands has been moved to next Wednesday at 10am due to scheduling conflicts. We will utilize this time to share important updates about Q2 priorities and the recent reorg. Please make every effort to attend if at all possible. There will be time at the end for Q&A. Reach out to me if you have any questions! Thanks guys.",
    flags: [
      {
        category: "Inclusive language",
        severity: "high",
        severityLabel: "Worth adjusting",
        issue: "'Thanks guys' reads as gendered. The team isn't all guys.",
        suggestion: "'Thanks everyone' or 'thanks team'.",
      },
      {
        category: "Plain language",
        severity: "low",
        severityLabel: "Quick polish",
        issue:
          "'Utilize this time' is jargon for 'use this time'. The casual register doesn't earn it.",
        suggestion:
          "'We'll use the time to cover Q2 priorities and the reorg.'",
      },
      {
        category: "Voice & tone",
        severity: "low",
        severityLabel: "Quick polish",
        issue:
          "'Please make every effort to attend if at all possible' is corporate hedging in a casual note.",
        suggestion:
          "'Plan to come' or 'show up if you can'. Confident reads as kind.",
      },
    ],
    rewrite:
      "Hey everyone, the all hands moved to next Wednesday at 10am. We'll cover Q2 priorities and the reorg, with 15 minutes at the end for questions. Plan to come; if you can't, the recording lands in #all-hands by EOD Thursday. Drop questions in the thread.",
  },
] as const;

export default function WritesPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <PageHeader
        eyebrow="Long-form review"
        title="The longer-form writing your team sends to itself."
        lede={
          <>
            Product updates. Security advisories. Internal announcements.
            ContentRX reviews the writing that lands in the inbox, the
            channel, and the all-hands deck. Same engine, same
            content-design judgment, on the longer-form writing your
            team already ships.
          </>
        }
        meta={
          <>
            Three examples below. Each shows the writer&apos;s draft, the
            content model&apos;s flags, and the suggested rewrite. The
            engine is calibrated for product and internal writing; for
            persuasive marketing copy expect more &lsquo;worth a look&rsquo;
            flags than usual.
          </>
        }
      />
      <div className="space-y-12">
        {EXAMPLES.map((example) => (
          <ExampleCard key={example.id} example={example} />
        ))}
      </div>
    </main>
  );
}

function ExampleCard({ example }: { example: Example }) {
  return (
    <article className="rounded-2xl border border-line bg-raised p-6 sm:p-8">
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow>{example.label}</Eyebrow>
        <Pill tone="stone" size="xs">
          Moment: {example.momentLabel}
        </Pill>
        <Pill tone="stone" size="xs">
          {example.contentTypeLabel}
        </Pill>
      </div>
      <p className="mt-4 text-base text-default">{example.intro}</p>

      <div className="mt-6 rounded-lg border border-line bg-canvas p-5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-quiet">
          The draft
        </p>
        <p className="mt-2 whitespace-pre-line text-sm text-strong">
          {example.inputText}
        </p>
      </div>

      <p className="mt-6 text-[10px] font-semibold uppercase tracking-wider text-quiet">
        Flags
      </p>
      <ul className="mt-2 space-y-3">
        {example.flags.map((flag, i) => (
          <li
            key={i}
            className="rounded-lg border border-line bg-canvas p-4 sm:p-5"
          >
            <div className="flex items-center gap-2">
              <Pill
                tone={flag.severity === "low" ? "stone" : "amber"}
                size="xs"
              >
                {flag.severityLabel}
              </Pill>
              <span className="text-[10px] font-medium uppercase tracking-wider text-quiet">
                ✦ AI
              </span>
              <span className="ml-auto text-[10px] font-medium uppercase tracking-wider text-quiet">
                {flag.category}
              </span>
            </div>
            <p className="mt-2 text-sm font-medium text-strong">
              {flag.issue}
            </p>
            <div className="mt-2 rounded-md bg-sunken p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-quiet">
                Suggested
              </p>
              <p className="mt-1 text-sm text-default">{flag.suggestion}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-6 rounded-lg border-2 border-accent-affirm-border bg-accent-affirm-soft/30 p-5 sm:p-6">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-quiet">
          Suggested rewrite
        </p>
        <p className="mt-2 whitespace-pre-line text-sm text-strong">
          {example.rewrite}
        </p>
      </div>
    </article>
  );
}
