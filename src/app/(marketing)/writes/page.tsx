/**
 * /writes — codebase-prose gallery, REFRAMED 2026-05-16 to the
 * locked north star ("the opinionated editor for the prose that
 * lives in a codebase"). The "long-form" form-taxonomy framing was
 * dropped 2026-05-16 (we frame by the moment and the act, not by
 * form length).
 *
 * The 2026-05-09 design sold "the longer-form writing your team sends
 * to itself" — product-update emails, security advisories, all-hands
 * pre-reads, policy notices. Every one was company comms / the inbox:
 * exactly the out-of-scope ground the north star refuses. This
 * reframe relocates the same failure modes to the prose that
 * actually lives in the repo and gets reviewed before merge:
 * README, API reference, PR description, design doc, runbook,
 * changelog.
 *
 * Craft bar (Robert, 2026-05-16; locked north-star quality bar #4,
 * "ContentRX is not cruel"): the "before" inputs are NOT cartoon
 * clichés of bad writing. Real engineers/PMs don't write badly on
 * purpose; they ship a reasonable shortcut when busy, distracted, or
 * stressed. Each input is a competent author's realistic shortcut
 * (assumed context, happy-path-only, terse because it was the 4th PR
 * today). The flag names what the reader loses and why, generously,
 * never prosecutorial. The rewrite PRESERVES the author's register
 * and sharpens within it; it does not flatten a terse voice into
 * bland README mush.
 *
 * Structure retained from the 2026-05-11 redesign (it works): chip
 * nav above the fold, per-example side-by-side "What you wrote" vs
 * "Suggested rewrite", flags collapsed into a <details> with a
 * severity-count summary visible by default.
 *
 * Substrate-clean (ADR 2026-04-25): customer-facing vocabulary only,
 * no `standard_id`, no `rule_version`, no engine snake_case enums.
 *
 * Voice: ContentRX's own strings (intro, flag issue/suggestion,
 * framing) are calm/confident/charming per docs/copy-vocabulary.md,
 * no em dashes, no semicolons, no colons. The inputText/rewrite
 * fields are demonstration content (the repo prose under review),
 * not the product's voice.
 */

import type { Metadata } from "next";
import { Eyebrow } from "@/components/ui/eyebrow";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";

export const metadata: Metadata = {
  title: "Codebase prose review. ContentRX",
  description:
    "ContentRX reviews the prose that lives in your repo. READMEs, API docs, PR descriptions, design docs, runbooks, changelogs, against one opinionated editorial standard before merge.",
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
  intro: string;
  inputText: string;
  flags: readonly Flag[];
  rewrite: string;
};

const EXAMPLES: readonly Example[] = [
  {
    id: "readme",
    label: "README",
    momentLabel: "Repo entry point",
    intro:
      "The first file anyone, or any agent, opens. It gets written by the person who knows the system best, which is exactly why it leaves out the things they already know.",
    inputText:
      "# orbit\n\nInternal service for tenant routing. Wraps the edge config and the tenant DB. See the RFC for background. Run `make dev` (needs the usual env from 1Password). Most things you'll touch are in `internal/router/`. Ping #orbit if stuck.",
    flags: [
      {
        category: "Clarity",
        severity: "medium",
        severityLabel: "Worth adjusting",
        issue:
          "The first line assumes the reader already knows what tenant routing decides here. Someone cloning this cold cannot tell what orbit is for before reading an RFC that isn't linked.",
        suggestion:
          "Add one sentence of what it decides. 'orbit maps each incoming request to a tenant and region before it reaches the app.' Keep the rest, the terse register is fine.",
      },
      {
        category: "Specific reference",
        severity: "medium",
        severityLabel: "Worth adjusting",
        issue:
          "'The RFC', 'the usual env', and '#orbit' each point somewhere only a current teammate can follow. The reader who needs the README most is the one who doesn't have those.",
        suggestion:
          "Link the RFC by path. Name the env file or bootstrap command. The Slack channel is a fine backstop, not the setup path.",
      },
      {
        category: "Voice and tone",
        severity: "low",
        severityLabel: "Quick polish",
        issue:
          "'Most things you'll touch are in internal/router/' is true for you today and dates fast, and it still doesn't give a first run.",
        suggestion:
          "One command that returns something proves the clone works and carries more than the orientation. Drop 'most things'.",
      },
    ],
    rewrite:
      "# orbit\n\norbit maps each incoming request to a tenant and region before it reaches the app. It wraps the edge config and the tenant DB.\n\n## Run it\n\n    cp .env.example .env   # values in 1Password, Eng vault, 'orbit'\n    make dev\n    curl localhost:8080/healthz   # {\"ok\":true} means you're good\n\nBackground: docs/rfcs/0007-tenant-routing.md. Code you'll usually touch: internal/router/. Stuck: #orbit.",
  },
  {
    id: "api-reference",
    label: "API reference",
    momentLabel: "Endpoint doc",
    intro:
      "Reference docs get written right after the endpoint ships, by the person who just built it. They document what they're looking at, the success path, and skip the parts that were obvious while their hands were on the code.",
    inputText:
      "### POST /v1/exports\n\nStarts an export job for the caller's workspace. Pass `format` (`csv` or `json`) and an optional `since` ISO timestamp. Returns the job id. Poll `GET /v1/exports/{id}` for status.",
    flags: [
      {
        category: "Completeness",
        severity: "high",
        severityLabel: "Worth adjusting",
        issue:
          "The success path is documented. The integrator's first real questions aren't. What auth does this need, what does a rejected request return, and is the job async with no callback. They hit those before they hit the happy path.",
        suggestion:
          "Add the auth line, one example error body, and a sentence that the job is async so the caller knows to poll.",
      },
      {
        category: "Clarity",
        severity: "medium",
        severityLabel: "Worth adjusting",
        issue:
          "'Returns the job id' in what shape. A bare string, a JSON object, a Location header. The integrator has to guess or read your source, which is the thing the doc exists to prevent.",
        suggestion:
          "Show the actual response. 'Returns 202 with {\"id\": \"exp_…\"}.'",
      },
      {
        category: "Specificity",
        severity: "low",
        severityLabel: "Quick polish",
        issue:
          "'Poll for status' has no interval and no terminal states, so every caller invents their own.",
        suggestion:
          "'Poll every 5s. Status is queued, running, done, or failed.' One sentence, one fewer support thread.",
      },
    ],
    rewrite:
      "### POST /v1/exports\n\nAuth: API key in the Authorization header. Starts an async export job for the caller's workspace.\n\nBody: `format` (`csv` or `json`, required), `since` (ISO timestamp, optional).\n\nReturns 202 with `{\"id\": \"exp_…\"}`. A bad `format` returns 422 with `{\"error\": \"format must be csv or json\"}`.\n\nPoll `GET /v1/exports/{id}` every 5s. Status is queued, running, done, or failed. No callback is sent.",
  },
  {
    id: "pr-description",
    label: "PR description",
    momentLabel: "Before merge",
    intro:
      "The description gets written last, when the work is done and you're tired and the next thing is waiting. So it gets the summary the author can write from memory, not the one the reviewer needs to review it.",
    inputText:
      "Fixes the flaky checkout test and tightens the retry logic while I was in there. Also bumped the timeout. Should be good now, tested locally.",
    flags: [
      {
        category: "Reviewability",
        severity: "high",
        severityLabel: "Worth adjusting",
        issue:
          "A reviewer approves the reasoning, not the diff. 'Tightens the retry logic' and 'bumped the timeout' say what changed but not what was wrong or why this fixes it, so they either re-derive it from the diff or rubber-stamp it.",
        suggestion:
          "One line of root cause per change. What made the test flaky, and what the retry logic was doing that it shouldn't.",
      },
      {
        category: "Clarity",
        severity: "medium",
        severityLabel: "Worth adjusting",
        issue:
          "'Should be good now' and 'tested locally' carry your confidence but not your evidence. The reviewer can't tell if 'tested locally' was the one test 50 times or the full suite once.",
        suggestion:
          "Say what you ran and what it covered. The reviewer is deciding how hard to look, and that line tells them.",
      },
      {
        category: "Scope",
        severity: "low",
        severityLabel: "Quick polish",
        issue:
          "Two unrelated changes in one description make the rollback story ambiguous if one of them regresses later.",
        suggestion:
          "A line each, or note they're coupled and why, so a future bisect knows what it's looking at.",
      },
    ],
    rewrite:
      "The checkout test was flaky because it asserted on order state before the webhook settled. Now it waits on the webhook instead of a fixed sleep.\n\nWhile there: retry logic was retrying on 4xx too. Now it retries 5xx and timeouts only. Timeout 5s to 15s because the payment sandbox p95 is 8s and we were timing out legitimate calls.\n\nRan the checkout suite 50x, green. Didn't touch unrelated payment paths.",
  },
  {
    id: "design-doc",
    label: "Design doc",
    momentLabel: "Before the build",
    intro:
      "A design doc written by someone who did the thinking and wants the reader to see the path they took. The proposal is in there, after a few paragraphs of the context they can't quite bring themselves to cut.",
    inputText:
      "## Background\n\nOver the last two quarters we've seen growth in multi-region usage, and the current single-region session store has come up repeatedly in incident reviews and planning. There are a number of considerations here, including latency, failover behavior, and operational surface. This document walks through the history and the options we weighed before arriving at a recommendation.\n\n## History\n\nThe session store was originally built for a single region because at the time...",
    flags: [
      {
        category: "Lead with the decision",
        severity: "high",
        severityLabel: "Worth adjusting",
        issue:
          "The reader opening a design doc needs the proposal first, what you want to do and the one reason it's right. The history matters, but a reviewer who has to mine three paragraphs for the recommendation reviews the writing, not the decision.",
        suggestion:
          "Open with a Proposal section. Move Background and History below it as the support they are.",
      },
      {
        category: "Clarity",
        severity: "medium",
        severityLabel: "Worth adjusting",
        issue:
          "'A number of considerations' and 'the options we weighed' name that tradeoffs exist without naming them. The doc's job is the tradeoff itself, not the fact that there was one.",
        suggestion:
          "State the considerations as the actual tension. 'Per-region primaries cut p99 but make failover a manual call.'",
      },
      {
        category: "Reviewability",
        severity: "low",
        severityLabel: "Quick polish",
        issue:
          "No stated alternative and no why-not. A doc that only presents the chosen path reads as a decision already made, which makes the review theater.",
        suggestion:
          "One paragraph on the option you rejected and the reason. It's what makes the review real.",
      },
    ],
    rewrite:
      "## Proposal\n\nMove the session store to a per-region primary with async cross-region replication. One reason above the others: every multi-region incident this quarter traced to cross-region session reads at p99.\n\n## Options weighed\n\nGlobal store with read replicas (rejected: replica lag still bit us on failover). Sticky regional routing (rejected: breaks on region drain). Per-region primary (proposed).\n\n## Background\n\nThe single-region store was right when there was one region...",
  },
  {
    id: "runbook",
    label: "Runbook",
    momentLabel: "On-call",
    intro:
      "Runbook steps get written during or right after the incident, by the person who just fixed it. It's exact in their head. On the page it's exact only if you were there too.",
    inputText:
      "### If the queue backs up\n\nCheck the consumer lag dashboard. If it's high, the workers are probably stuck again. Restart them the usual way and keep an eye on it. If that doesn't help, escalate to the platform team.",
    flags: [
      {
        category: "Specificity",
        severity: "high",
        severityLabel: "Worth adjusting",
        issue:
          "The next on-call doesn't know what 'high' is, what 'the usual way' restarts, or how long to watch before escalating. A runbook is read by the person who wasn't there, and every judgment word it leaves in is a call they make at 3am without you.",
        suggestion:
          "Replace each judgment word with the number you actually used. The threshold, the command, the wait.",
      },
      {
        category: "Clarity",
        severity: "medium",
        severityLabel: "Worth adjusting",
        issue:
          "'The workers are probably stuck again' references a past incident the reader may not have lived through. Name the symptom that confirms it, not the memory of last time.",
        suggestion:
          "State what 'stuck' looks like on the dashboard so the reader can confirm it themselves.",
      },
      {
        category: "Specificity",
        severity: "low",
        severityLabel: "Quick polish",
        issue:
          "'Keep an eye on it' and 'if that doesn't help' have no threshold, so the reader can't tell when to stop waiting.",
        suggestion:
          "Give it a clock. 'Lag should fall within 5 min. If it isn't falling by then, escalate.'",
      },
    ],
    rewrite:
      "### If the queue backs up\n\n1. Open the consumer-lag dashboard. Trigger: lag over 50k messages, or rising for more than 5 min.\n2. Restart the workers: `kubectl rollout restart deploy/queue-worker -n prod`.\n3. Lag should fall within 5 min. If it isn't falling by then, page #platform-oncall (PagerDuty service 'queue') with the dashboard link.",
  },
  {
    id: "changelog",
    label: "Changelog",
    momentLabel: "Release notes",
    intro:
      "Release notes get written under the release, from the merge list, by someone who knows what each line did and is compressing fast. The compression is where the reader loses the one change that affects them.",
    inputText:
      "## v2.4.0\n\n- Performance improvements to the sync engine\n- Fixed several edge cases in auth\n- Various dependency updates\n- Minor UI polish",
    flags: [
      {
        category: "Reader impact",
        severity: "high",
        severityLabel: "Worth adjusting",
        issue:
          "A changelog answers one question, does this release change something I rely on. 'Fixed several edge cases in auth' can't be acted on. The person whose login flow just changed needs to see that line and recognize it as theirs.",
        suggestion:
          "Write each line so the affected reader recognizes it. Name the behavior that changed, not the category it was in.",
      },
      {
        category: "Clarity",
        severity: "medium",
        severityLabel: "Worth adjusting",
        issue:
          "'Performance improvements to the sync engine' is the result, not the change. If sync now batches differently or a default moved, that's the line. The speedup is the consequence.",
        suggestion:
          "Lead with what changed, then the effect. 'Sync batches writes in 200-record chunks, large syncs ~4x faster.'",
      },
      {
        category: "Reader impact",
        severity: "low",
        severityLabel: "Quick polish",
        issue:
          "'Various dependency updates' hides whether any of them are breaking.",
        suggestion:
          "One sub-line for anything that moves a minimum version or a default. It earns the reader's trust in the rest of the list.",
      },
    ],
    rewrite:
      "## v2.4.0\n\n- Sync batches writes in 200-record chunks (was per-record). No API change. Large syncs are ~4x faster.\n- Auth: expired refresh tokens now return 401 instead of 500. If you retried on 500, that path no longer fires.\n- Dropped Node 16 support. Minimum is now Node 18.\n- Settings: moved 'Danger zone' below the fold so it isn't the first thing your cursor lands on.",
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
        eyebrow="Wherever you work. Whatever you write."
        title="The prose that lives in your codebase."
        lede={
          <>
            READMEs. API docs. PR descriptions. Design docs. Runbooks.
            Changelogs. ContentRX reviews the prose that lives in your
            repo, against one opinionated editorial standard, before it
            merges.
          </>
        }
        meta={
          <>
            Six examples below. Each is real writing under time
            pressure, the cleaned rewrite, and why each flag fired.
            Calibrated for the prose that ships in a codebase.
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
            className="inline-flex h-7 items-center rounded-full border border-line bg-raised px-3 text-xs font-medium text-default transition hover:border-line-strong hover:bg-canvas hover:text-strong"
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
        <Pill tone="neutral" size="xs">
          {example.momentLabel}
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
