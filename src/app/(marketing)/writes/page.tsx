/**
 * /writes — long-form gallery (Phase F, 2026-05-09 roadmap).
 *
 * Six examples in two groups:
 *
 *   F3a (day 1): product update, security advisory, internal announcement
 *   F3b (day 2): all-hands pre-read, incident update, policy notice
 *
 * 2026-05-11 redesign (Robert): the stacked single-column layout
 * read as a wall of text — six 800px-tall cards with input → flags
 * → rewrite in a vertical chain. Hard to scan, hard to compare
 * before vs after.
 *
 * New shape:
 *
 *   1. Chip nav above the fold — six labels, one click to anchor.
 *      The reader sees what's covered without scrolling. The chip
 *      that matches their use case is the one that matters; the
 *      others are credibility.
 *   2. Per-example side-by-side: "What you wrote" | "Suggested
 *      rewrite" in a 2-col grid at lg+. The before/after comparison
 *      IS the value-prop; making it the first thing the eye lands on
 *      teaches the product faster than any prose.
 *   3. Flags collapsed into a <details> with a severity-count summary
 *      visible by default. Curious readers expand; casual readers
 *      get the comparison and move on. SEO unaffected — all content
 *      ships in the markup.
 *
 * Each example shrinks from ~800px to ~450px collapsed (~700px when
 * flags expanded). Six examples = ~2,700px instead of 4,800px. The
 * page reads as a scannable showcase, not a wall.
 *
 * Substrate-clean (ADR 2026-04-25): customer-facing vocabulary only,
 * no `standard_id`, no `rule_version`, no engine snake_case enums.
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
  {
    id: "all-hands-pre-read",
    label: "All-hands pre-read",
    momentLabel: "Team notification",
    contentTypeLabel: "Long-form",
    intro:
      "An email kicking off the next all-hands. Sets the agenda, the format, and what to bring. The all-hands itself is the meeting; this email is the pre-read.",
    inputText:
      "Hi team! Just wanted to give you all a comprehensive heads-up on next week's all-hands meeting. We have an incredibly exciting agenda lined up, including a deep-dive into Q1 performance, some exciting strategic initiatives, and updates on the recent organizational changes. We'd really appreciate it if everyone could make every effort to attend in person, as we believe face-to-face engagement maximizes value creation across the organization. Please don't hesitate to reach out if you have any questions or concerns!",
    flags: [
      {
        category: "Plain language",
        severity: "medium",
        severityLabel: "Worth adjusting",
        issue:
          "'Comprehensive heads-up', 'deep-dive', 'strategic initiatives', 'maximizes value creation across the organization'. The corporate stack hides the actual agenda.",
        suggestion:
          "Replace with the agenda. The reader is opening a pre-read; tell them what they'll cover.",
      },
      {
        category: "Voice & tone",
        severity: "medium",
        severityLabel: "Worth adjusting",
        issue:
          "'We'd really appreciate it if everyone could make every effort' is hedged politeness. It signals the writer expects pushback on the ask.",
        suggestion:
          "Just ask. 'Plan to come in person' carries the same request without the hedging.",
      },
      {
        category: "Active voice",
        severity: "low",
        severityLabel: "Quick polish",
        issue:
          "'Maximizes value creation across the organization' hides who creates the value. Name the people.",
        suggestion:
          "'In-person meetings give the team a real conversation about strategy.' carries the actor.",
      },
    ],
    rewrite:
      "Subject: Next Wednesday's all-hands. Pre-read.\n\nHey team. Next Wednesday at 10am Pacific. Three blocks: Q1 numbers (15 min), the reorg in detail (20 min), what's next (10 min). The last 15 minutes are open for questions. In-person is better but the recording lands in #all-hands by EOD Wednesday. Drop questions in the thread before then; we'll batch them into the Q&A block.",
  },
  {
    id: "incident-update",
    label: "Incident update",
    momentLabel: "Outage update",
    contentTypeLabel: "Long-form",
    intro:
      "A status update during an active incident. The audience is anxious and the fact set is changing. Specifics build trust; vagueness corrodes it.",
    inputText:
      "We are currently experiencing some intermittent issues with our platform that may be affecting some users. Our engineering team is working diligently to investigate and resolve the situation as quickly as possible. We sincerely apologize for any inconvenience this may be causing and appreciate your patience as we work to restore full service. We will provide additional updates as more information becomes available.",
    flags: [
      {
        category: "Voice & tone",
        severity: "high",
        severityLabel: "Worth adjusting",
        issue:
          "'Intermittent issues' / 'may be affecting' is the worst register for an incident comm. Vague language reads as the writer not knowing what's wrong, which reads as the team not being on it.",
        suggestion:
          "Name the failure mode and the affected scope. 'Dashboard checks return 500 for ~40% of requests' beats 'intermittent issues' on every dimension.",
      },
      {
        category: "Plain language",
        severity: "medium",
        severityLabel: "Worth adjusting",
        issue:
          "'Working diligently' and 'sincerely apologize for any inconvenience' are filler. Specifics build trust during outages, not apology.",
        suggestion:
          "Replace with the actions in flight. 'Reduced rate limits, scaling the function pool, watching error rate.'",
      },
      {
        category: "Voice & tone",
        severity: "medium",
        severityLabel: "Worth adjusting",
        issue:
          "'We will provide additional updates as more information becomes available' leaves the reader hanging. The reader needs a cadence.",
        suggestion:
          "Promise a time. 'Next update at 3:30 PM Pacific.'",
      },
    ],
    rewrite:
      "3:00 PM Pacific. Dashboard checks are returning 500 for ~40% of requests. The Python engine itself is healthy; the API gateway is dropping connections to the function pool under load. Mitigation in flight: we lowered the per-IP rate limit and are scaling the pool. Customers on the Free plan are most affected. Next update at 3:30 PM Pacific. Status page: status.contentrx.io.",
  },
  {
    id: "policy-notice",
    label: "Policy notice",
    momentLabel: "Compliance disclosure",
    contentTypeLabel: "Long-form",
    intro:
      "A change to terms, privacy, billing, or company policy. Compliance puts the bar high; readers skim, so the headline has to do the work.",
    inputText:
      "Important Update Regarding Our Terms of Service\n\nDear valued customer, we are writing to inform you that we have made some important changes to our Terms of Service. These updates are designed to enhance our ability to provide you with the best possible service while ensuring compliance with various regulatory requirements. The new terms will go into effect on June 1st, 2026. We encourage you to review the updated terms at your earliest convenience. Please don't hesitate to contact us if you have any questions or concerns regarding these changes.",
    flags: [
      {
        category: "Voice & tone",
        severity: "high",
        severityLabel: "Worth adjusting",
        issue:
          "'Important Update Regarding Our Terms of Service' buries the news. The reader skims; the subject line has to name what changed.",
        suggestion:
          "Lead with the change, not the framing. 'Two changes to our terms, effective June 1.'",
      },
      {
        category: "Plain language",
        severity: "high",
        severityLabel: "Worth adjusting",
        issue:
          "'Designed to enhance our ability to provide you with the best possible service while ensuring compliance with various regulatory requirements' tells the reader nothing. Compliance copy is the place where vague is least defensible.",
        suggestion:
          "Name the changes by number, with one sentence each.",
      },
      {
        category: "Voice & tone",
        severity: "low",
        severityLabel: "Quick polish",
        issue:
          "'Dear valued customer' is corporate cold-open. The mismatch between this register and the rest of the product reads as outsourced.",
        suggestion:
          "'Hi' or first-name from the team. The customer can tell the difference.",
      },
    ],
    rewrite:
      "Subject: Two changes to our terms, effective June 1\n\nHi everyone. We're updating two things in our Terms of Service on June 1, 2026.\n\n1. Data residency. We'll process customer strings in US-East and EU-West regions only. Today's terms named US-East alone.\n2. Subprocessor list. We added Vercel (our deployment host since launch) to the explicit list.\n\nNeither change affects how your team uses ContentRX. The full diff is at /privacy/terms-changes-2026-06. Reply if anything needs clarifying.",
  },
] as const;

/** Severity rollup for the per-example summary line above each flags
 * disclosure. Tells the reader what kind of trouble the example
 * teaches before they choose whether to expand the details. */
function severityCounts(flags: readonly Flag[]) {
  const counts = { high: 0, medium: 0, low: 0 };
  for (const f of flags) counts[f.severity]++;
  return counts;
}

export default function WritesPage() {
  return (
    // Widened to max-w-6xl to give the side-by-side input/rewrite
    // grid room to breathe at lg+. The prior max-w-3xl forced the
    // two panels under each other even on wide screens, which
    // defeated the before/after comparison the redesign exists for.
    <main className="mx-auto max-w-6xl px-6 py-20">
      <PageHeader
        eyebrow="Long-form review"
        title="The longer-form writing your team sends to itself."
        lede={
          <>
            Product updates. Security advisories. Internal announcements.
            All-hands pre-reads. Incident updates. Policy notices.
            ContentRX reviews the writing that lands in the inbox, the
            channel, and the all-hands deck. Same engine, same
            content-design judgment, on the longer-form writing your
            team already ships.
          </>
        }
        meta={
          <>
            Six examples below. Each shows what the writer started
            with, the cleaned rewrite, and why each flag fired. The
            engine is calibrated for product and internal writing; for
            persuasive marketing copy expect more &lsquo;worth a look&rsquo;
            flags than usual.
          </>
        }
      />

      {/* Chip nav — six labels, click to jump. Border-y rule reads as a
          contents shelf above the examples, mirrors the home page
          IntegrationRow's role between hero and animation. */}
      <nav
        aria-label="Examples"
        className="mt-12 flex flex-wrap items-center gap-2 border-y border-line py-4"
      >
        <span className="mr-2 text-xs font-semibold uppercase tracking-wider text-quiet">
          Jump to
        </span>
        {EXAMPLES.map((ex) => (
          <a
            key={ex.id}
            href={`#${ex.id}`}
            className="inline-flex h-7 items-center rounded-full border border-line bg-raised px-3 text-xs font-medium text-default transition hover:border-line-strong hover:text-strong"
          >
            {ex.label}
          </a>
        ))}
      </nav>

      <div className="mt-12 space-y-20">
        {EXAMPLES.map((example) => (
          <ExampleCard key={example.id} example={example} />
        ))}
      </div>
    </main>
  );
}

function ExampleCard({ example }: { example: Example }) {
  const counts = severityCounts(example.flags);
  const worthAdjusting = counts.high + counts.medium;
  const quickPolish = counts.low;

  return (
    // No outer card chrome — the page itself frames the example
    // (border-b on header + space-y-20 between siblings). One frame
    // per example reads tighter than nested borders.
    <article id={example.id} className="scroll-mt-16">
      <header className="flex flex-wrap items-baseline gap-3 border-b border-line pb-3">
        <Eyebrow>{example.label}</Eyebrow>
        <Pill tone="stone" size="xs">
          Moment: {example.momentLabel}
        </Pill>
        <Pill tone="stone" size="xs">
          {example.contentTypeLabel}
        </Pill>
      </header>

      <p className="mt-4 text-base text-default">{example.intro}</p>

      {/* Side-by-side input vs rewrite. Stack on mobile, 2-col at lg+
          so the comparison is the first thing the eye lands on at
          desktop widths. */}
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-line bg-canvas p-5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-quiet">
            What you wrote
          </p>
          <p className="mt-2 whitespace-pre-line text-sm text-strong">
            {example.inputText}
          </p>
        </div>
        <div className="rounded-lg border-2 border-accent-affirm-border bg-accent-affirm-soft/40 p-5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-quiet">
            Suggested rewrite
          </p>
          <p className="mt-2 whitespace-pre-line text-sm text-strong">
            {example.rewrite}
          </p>
        </div>
      </div>

      {/* Flag summary — visible by default so the reader gets the
          severity story without expanding. Curious readers open the
          disclosure for the per-flag reasoning. */}
      <details className="mt-4 rounded-lg border border-line bg-raised">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-hover">
          <span className="text-sm font-medium text-strong">
            {example.flags.length} flags applied
            {worthAdjusting > 0 && (
              <span className="ml-1 font-normal text-default">
                · {worthAdjusting} worth adjusting
              </span>
            )}
            {quickPolish > 0 && (
              <span className="ml-1 font-normal text-default">
                · {quickPolish} quick polish
              </span>
            )}
          </span>
          <span className="text-xs text-quiet">
            See the per-flag reasoning <span aria-hidden>▾</span>
          </span>
        </summary>
        <ul className="space-y-2 border-t border-line bg-canvas p-4">
          {example.flags.map((flag, i) => (
            <li
              key={i}
              className="rounded-md border border-line bg-raised p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
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
      </details>
    </article>
  );
}
