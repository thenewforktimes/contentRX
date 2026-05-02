/**
 * /dashboard/explain client island.
 *
 * Posts to /api/check via fetch, renders the schema 2.0.0 public
 * envelope: violations carry only `issue`, `suggestion`, `severity`,
 * and `confidence`. Substrate fields (`standard_id`, `rule_version`,
 * `rationale_chain`, `moment`, etc.) are stripped at the API boundary
 * per ADR 2026-04-25 and never reach this component.
 *
 * Founder substrate visibility lives at `/admin` (Phase B), not here.
 *
 * Human-eval build plan Session 21; rewritten for schema 2.0.0
 * (ADR 2026-04-25).
 */

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FindingAdjustModal } from "@/components/finding-adjust-modal";
import { FindingMakeRuleModal } from "@/components/finding-make-rule-modal";
import { FlagForReview } from "@/components/flag-for-review";
import { Pill } from "@/components/ui/pill";
import type { PublicCheckEnvelope, PublicViolation } from "@/lib/api-envelope";
import {
  CHECK_TIERS,
  MAX_INPUT_CHARS,
  STANDARD_CHAR_CAP,
  UNIT_COST_FLAT,
  type CheckTier,
  meter,
} from "@/lib/metering";
import type { Plan } from "@/lib/quotas";
import {
  humanizeReviewReason,
  humanizeSeverity,
  humanizeVerdict,
} from "@/lib/humanize";
import { wordDiff, type DiffToken } from "@/lib/text-diff";
import {
  dispatchCheckCompleted,
  dispatchSuggestionCopied,
} from "../dashboard-check-events";

type CheckEnvelope = PublicCheckEnvelope & {
  latency_ms: number;
  // The /api/check route appends usage info to the response (route.ts
  // line ~327). Typed here so we can broadcast it to sibling Client
  // Components for optimistic UI updates.
  usage?: {
    used: number;
    quota: number;
    remaining: number;
  };
  // Snapshot of the textarea value at submission time. Stored on the
  // response so DiffBlock's "before" line stays pinned to what the
  // user actually checked. Without this, pasting fresh copy into the
  // textarea re-renders the existing diff with the new text struck
  // through and the previous suggestion still shown — which looks
  // like the engine flagged the new text but actually reflects the
  // earlier check.
  submittedText: string;
};

// Tier metadata for the selector. Labels stay user-facing; the
// underlying tier values (`standard | document | surface`) match the
// /api/check `segment_type` enum.
const TIER_LABELS: Record<CheckTier, string> = {
  standard: "Standard",
  document: "Document",
  surface: "Surface",
};
const TIER_HINTS: Record<CheckTier, string> = {
  standard: `1 unit per ${STANDARD_CHAR_CAP} chars`,
  document: `${UNIT_COST_FLAT.document} units flat`,
  surface: `${UNIT_COST_FLAT.surface} units flat`,
};

/**
 * Structured error states the inline check can render. Mapping API
 * status codes to a kind here keeps the UI free of HTTP details and
 * lets each branch render in plain English instead of dumping JSON.
 */
type CheckError =
  | { kind: "quota"; used: number; quota: number; resetsAt: string | null }
  | { kind: "auth" }
  | { kind: "rate_limit"; retryAfterSeconds: number | null }
  | { kind: "server" }
  | { kind: "network" }
  | { kind: "unknown"; status: number; message: string };

export function ExplainClient({ plan = "free" }: { plan?: Plan } = {}) {
  const router = useRouter();
  const [text, setText] = useState(
    "Unable to complete operation. Please contact administrator.",
  );
  const [tier, setTier] = useState<CheckTier>("standard");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<CheckError | null>(null);
  const [response, setResponse] = useState<CheckEnvelope | null>(null);

  async function onCheck() {
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, source: "dashboard", segment_type: tier }),
      });
      if (!res.ok) {
        const body = await res.text();
        let parsed: Record<string, unknown> | null = null;
        try {
          parsed = JSON.parse(body) as Record<string, unknown>;
        } catch {
          // body wasn't JSON — fall through to unknown branch with raw text
        }
        setError(mapHttpError(res.status, parsed, body));
        return;
      }
      const data = (await res.json()) as Omit<CheckEnvelope, "submittedText">;
      // Capture the text we just submitted so DiffBlock renders against
      // a stable "before" line even if the user keeps editing the
      // textarea afterward.
      setResponse({ ...data, submittedText: text });
      // Optimistic UI: broadcast the completed check to sibling Client
      // Components (UsagePanelLive, ActiveSurfacesRowLive) so the
      // counter and Web app surface card jump immediately, instead of
      // waiting ~200ms for router.refresh() to round-trip new
      // server-rendered HTML. The response carries fresh usage data
      // already; reusing it costs nothing and saves the latency.
      if (data.usage) {
        dispatchCheckCompleted({
          source: "dashboard",
          usage: {
            used: data.usage.used,
            quota: data.usage.quota,
            remaining: data.usage.remaining,
          },
        });
      }
      // Still call router.refresh() for everything that ISN'T covered
      // by the optimistic broadcast: This-week insights, first-call
      // banner activation, plan-pill changes (free → pro), etc.
      // /api/check already busts the relevant cache tags via
      // revalidateDashboard(); router.refresh() is what tells the
      // current browser tab to actually re-fetch the server output.
      router.refresh();
    } catch {
      // Network failure (no res object), CORS, DNS, etc. The thrown
      // Error doesn't carry useful info for the user — fail to a
      // generic "couldn't reach the service" message instead of
      // "TypeError: NetworkError when attempting to fetch resource."
      setError({ kind: "network" });
    } finally {
      setLoading(false);
    }
  }

  /**
   * HTTP status → typed CheckError. Kept inside the component so the
   * field-name dependencies on the API response shape stay co-located
   * with the renderer.
   */
  function mapHttpError(
    status: number,
    parsed: Record<string, unknown> | null,
    raw: string,
  ): CheckError {
    if (status === 402) {
      return {
        kind: "quota",
        used: typeof parsed?.used === "number" ? parsed.used : 0,
        quota: typeof parsed?.quota === "number" ? parsed.quota : 0,
        resetsAt:
          typeof parsed?.resets_at === "string" ? parsed.resets_at : null,
      };
    }
    if (status === 401) {
      return { kind: "auth" };
    }
    if (status === 429) {
      return {
        kind: "rate_limit",
        retryAfterSeconds:
          typeof parsed?.retry_after_seconds === "number"
            ? parsed.retry_after_seconds
            : null,
      };
    }
    if (status >= 500) {
      return { kind: "server" };
    }
    const message =
      typeof parsed?.error === "string"
        ? parsed.error
        : raw.slice(0, 200) || `HTTP ${status}`;
    return { kind: "unknown", status, message };
  }

  const decision = meter(text, tier);
  const overLimit = text.length > MAX_INPUT_CHARS;

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label
            htmlFor="explain-text"
            className="block text-sm font-medium text-stone-700 dark:text-stone-300"
          >
            Text to evaluate
          </label>
          <fieldset className="flex items-center gap-2 text-xs">
            <legend className="sr-only">Check tier</legend>
            <span className="text-stone-500 dark:text-stone-400">
              Tier
            </span>
            <div
              role="radiogroup"
              aria-label="Check tier"
              className="inline-flex rounded-md border border-stone-300 bg-white p-0.5 dark:border-stone-700 dark:bg-stone-950"
            >
              {CHECK_TIERS.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={tier === t}
                  onClick={() => setTier(t)}
                  className={`rounded-sm px-2 py-1 transition ${
                    tier === t
                      ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
                      : "text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100"
                  }`}
                  title={TIER_HINTS[t]}
                >
                  {TIER_LABELS[t]}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        <textarea
          id="explain-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="Try pasting a button label, an error message, or a paragraph from your latest PR"
          className={`w-full rounded-md border bg-white px-3 py-2 font-mono text-sm text-stone-900 focus:outline-none focus:ring-1 dark:bg-stone-950 dark:text-stone-100 ${
            overLimit
              ? "border-red-500 focus:border-red-500 focus:ring-red-500"
              : "border-stone-300 focus:border-stone-500 focus:ring-neutral-500 dark:border-stone-700"
          }`}
        />
        <div className="flex items-center justify-between gap-3 text-xs">
          <span
            className={`tabular-nums ${
              overLimit
                ? "text-red-600 dark:text-red-400"
                : text.length > MAX_INPUT_CHARS * 0.9
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-stone-500 dark:text-stone-300"
            }`}
          >
            {text.length.toLocaleString()} characters
            {text.length > 0 && (
              <>
                {" · "}
                <strong className="font-semibold">
                  {decision.unitsConsumed}{" "}
                  {decision.unitsConsumed === 1 ? "unit" : "units"}
                </strong>{" "}
                ({TIER_LABELS[tier].toLowerCase()})
              </>
            )}
          </span>
          {overLimit ? (
            <span className="text-right text-red-600 dark:text-red-400">
              Too long. Split into pieces ≤{" "}
              {MAX_INPUT_CHARS.toLocaleString()} chars, or use{" "}
              <Link href="/install" className="underline underline-offset-2">
                another surface →
              </Link>
            </span>
          ) : (
            <span className="text-stone-500 dark:text-stone-300">
              {TIER_HINTS[tier]}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onCheck}
          disabled={
            loading ||
            text.trim().length === 0 ||
            overLimit
          }
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50 dark:bg-emerald-400 dark:text-emerald-950 dark:hover:bg-emerald-300"
        >
          {loading ? "Checking…" : "Check"}
        </button>
      </section>

      {error && <ErrorBlock error={error} />}

      {response && (
        <section className="space-y-4">
          <VerdictHeader
            verdict={response.verdict}
            reviewReason={response.review_reason}
            findingCount={response.violations.length}
          />
          {response.violations.length > 0 && (
            <ul className="space-y-2">
              {response.violations.map((v, i) => (
                <FindingCard
                  key={i}
                  finding={v}
                  submittedText={response.submittedText}
                  plan={plan}
                />
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <p className="text-xs text-stone-500 dark:text-stone-300">
              Evaluated in {response.latency_ms} ms.
            </p>
            <FlagForReview
              text={response.submittedText}
              verdict={
                response.verdict === "pass" ||
                response.verdict === "violation" ||
                response.verdict === "review_recommended"
                  ? response.verdict
                  : null
              }
              source="dashboard"
            />
          </div>
        </section>
      )}
    </div>
  );
}

function VerdictHeader({
  verdict,
  reviewReason,
  findingCount,
}: {
  verdict: string;
  reviewReason: string | null;
  findingCount: number;
}) {
  // Per ADR 2026-04-29 §9a — customer surface speaks "Findings" /
  // "All clear" / "Worth a look" / "N findings to adjust", not raw
  // substrate verdict enums. Rendering goes through humanizeVerdict
  // at the boundary; the same helper is shared by every customer
  // surface (web, MCP, CLI, GitHub Action, LSP, Figma plugin) so the
  // language is identical wherever findings render.
  const { label, tone } = humanizeVerdict(verdict, findingCount);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Pill tone={tone}>{label}</Pill>
      {reviewReason && (
        <span className="text-sm text-stone-600 dark:text-stone-300">
          {humanizeReviewReason(reviewReason)}
        </span>
      )}
    </div>
  );
}

/**
 * Inline before/after diff for a violation's suggestion. Two stacked
 * lines with word-level red/green highlighting — same algorithm the
 * Figma plugin, GitHub Action, and LSP code action use, so the same
 * change always reads the same way.
 *
 * `before` is the text the user submitted (the whole input, since
 * the schema 2.0.0 envelope doesn't carry per-violation offsets).
 * `after` is the violation's `suggestion` field.
 */
function DiffBlock({ before, after }: { before: string; after: string }) {
  const tokens = wordDiff(before, after);
  return (
    <div className="mt-2 space-y-1 font-mono text-xs">
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="select-none text-stone-400 dark:text-stone-600"
        >
          −
        </span>
        <span className="break-words text-stone-700 dark:text-stone-300">
          {tokens
            .filter((t) => t.kind === "equal" || t.kind === "removed")
            .map((t, i) => (
              <DiffSpan key={`b-${i}`} token={t} side="before" />
            ))}
        </span>
      </div>
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="select-none text-stone-400 dark:text-stone-600"
        >
          +
        </span>
        <span className="break-words text-stone-700 dark:text-stone-300">
          {tokens
            .filter((t) => t.kind === "equal" || t.kind === "added")
            .map((t, i) => (
              <DiffSpan key={`a-${i}`} token={t} side="after" />
            ))}
        </span>
      </div>
    </div>
  );
}

function DiffSpan({
  token,
  side,
}: {
  token: DiffToken;
  side: "before" | "after";
}) {
  if (token.kind === "equal") {
    return <>{token.text}</>;
  }
  if (token.kind === "removed" && side === "before") {
    return (
      <span className="bg-red-100 text-red-900 line-through dark:bg-red-950/60 dark:text-red-300">
        {token.text}
      </span>
    );
  }
  if (token.kind === "added" && side === "after") {
    return (
      <span className="bg-green-100 text-green-900 dark:bg-green-950/60 dark:text-green-300">
        {token.text}
      </span>
    );
  }
  return null;
}

/**
 * Renders an inline check error in plain English. Each branch maps
 * to a CheckError kind in onCheck() — quota exhaustion gets pricing
 * + reset date, auth gets API-key guidance, rate-limit shows a
 * countdown, server errors stay generic.
 *
 * Tone matches Robert's voice (PR-42 vocabulary refactor):
 *   - direct, no jargon
 *   - states the fact + the next action
 *   - one CTA when there's a useful one, never a list of links
 */
function ErrorBlock({ error }: { error: CheckError }) {
  if (error.kind === "quota") {
    const resetDay = error.resetsAt ? formatResetDate(error.resetsAt) : null;
    return (
      <div
        role="alert"
        className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950"
      >
        <h3 className="font-semibold text-amber-900 dark:text-amber-200">
          Monthly limit reached
        </h3>
        <p className="text-amber-900 dark:text-amber-300">
          You&apos;ve used all {error.quota.toLocaleString()} checks for this
          month
          {resetDay ? `. Resets ${resetDay}` : ""}.
        </p>
        <Link
          href="/pricing?from=quota"
          className="mt-1 inline-block self-start rounded-md bg-amber-900 px-3 py-1.5 text-xs font-medium text-amber-50 hover:opacity-90 dark:bg-amber-200 dark:text-amber-950"
        >
          View plans
        </Link>
      </div>
    );
  }
  if (error.kind === "auth") {
    return (
      <div
        role="alert"
        className="flex flex-col gap-2 rounded-md border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950"
      >
        <h3 className="font-semibold text-red-900 dark:text-red-200">
          Session expired
        </h3>
        <p className="text-red-900 dark:text-red-300">
          You were signed out. Refresh the page to sign back in.
        </p>
      </div>
    );
  }
  if (error.kind === "rate_limit") {
    const seconds = error.retryAfterSeconds;
    return (
      <div
        role="alert"
        className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950"
      >
        <h3 className="font-semibold text-amber-900 dark:text-amber-200">
          Hold on a sec
        </h3>
        <p className="text-amber-900 dark:text-amber-300">
          Too many checks too fast
          {seconds ? `. Try again in ${seconds}s` : ", try again in a moment"}.
        </p>
      </div>
    );
  }
  if (error.kind === "server") {
    return (
      <div
        role="alert"
        className="flex flex-col gap-2 rounded-md border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950"
      >
        <h3 className="font-semibold text-red-900 dark:text-red-200">
          Something broke on our end
        </h3>
        <p className="text-red-900 dark:text-red-300">
          The check service hit an error. Try again. If it keeps happening,
          it&apos;s on us.
        </p>
      </div>
    );
  }
  if (error.kind === "network") {
    return (
      <div
        role="alert"
        className="flex flex-col gap-2 rounded-md border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950"
      >
        <h3 className="font-semibold text-red-900 dark:text-red-200">
          Couldn&apos;t reach the check service
        </h3>
        <p className="text-red-900 dark:text-red-300">
          Check your connection and try again.
        </p>
      </div>
    );
  }
  // unknown: render the upstream message but in a readable shape.
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-md border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950"
    >
      <h3 className="font-semibold text-red-900 dark:text-red-200">
        Couldn&apos;t complete the check
      </h3>
      <p className="text-red-900 dark:text-red-300">{error.message}</p>
    </div>
  );
}

function formatResetDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return "next month";
    // The API returns the calendar boundary as midnight UTC (e.g.
    // 2026-05-01T00:00:00.000Z). Local timezones west of UTC (like
    // Pacific) render that instant as the previous day evening, so
    // without `timeZone: "UTC"` a user in PT sees "April 30" for a
    // reset that's actually on May 1. Pin the format to UTC.
    return d.toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return "next month";
  }
}

/**
 * FindingCard — one row in the violations list. Owns the per-card
 * state for the Adjust modal and the post-save "Your version" inline
 * affordance. Per ADR 2026-04-29 §4: after a save, the card stays
 * visible but shows the user's rewrite labeled "Your version" beside
 * the original LLM suggestion (when the rewrite path was taken),
 * plus a "Recorded" affordance on the verdict path.
 */
function FindingCard({
  finding,
  submittedText,
  plan,
}: {
  finding: PublicViolation;
  submittedText: string;
  plan: Plan;
}) {
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [makeRuleOpen, setMakeRuleOpen] = useState(false);
  const [savedState, setSavedState] = useState<{
    verdictRecorded: boolean;
    rewriteRecorded: boolean;
    rewriteText: string | null;
  } | null>(null);
  const [ruleSaved, setRuleSaved] = useState(false);

  return (
    <li className="rounded-md border border-stone-200 bg-white p-3 text-sm dark:border-stone-800 dark:bg-stone-900">
      <div className="flex items-start justify-between gap-3">
        <SeverityBadge severity={finding.severity} />
        <div className="flex shrink-0 items-center gap-2">
          {finding.suggestion && (
            <CopySuggestionButton
              submittedText={submittedText}
              suggestion={finding.suggestion}
              severity={finding.severity}
              confidence={finding.confidence}
              issue={finding.issue}
            />
          )}
          <button
            type="button"
            onClick={() => setAdjustOpen(true)}
            aria-label="Adjust this finding"
            className="shrink-0 rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-200 dark:hover:bg-stone-900"
          >
            Adjust
          </button>
          <FlagForReview
            text={submittedText}
            verdict="violation"
            variant="card-action"
            source="dashboard"
            contextLine={`Flagging finding: "${truncateForContext(finding.issue)}"`}
          />
          <MakeRuleButton plan={plan} onOpen={() => setMakeRuleOpen(true)} />
        </div>
      </div>
      <p className="mt-2 text-stone-900 dark:text-stone-100">{finding.issue}</p>
      {finding.suggestion && (
        <DiffBlock before={submittedText} after={finding.suggestion} />
      )}

      {savedState?.rewriteText && (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50/50 px-3 py-2 dark:border-emerald-900 dark:bg-emerald-950/20">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
            Your version
          </p>
          <p className="mt-1 text-sm text-stone-900 dark:text-stone-100">
            {savedState.rewriteText}
          </p>
        </div>
      )}

      {savedState && !savedState.rewriteText && savedState.verdictRecorded && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-xs text-emerald-700 dark:text-emerald-300">
            Recorded. Thanks for the calibration signal.
          </p>
          {/* ADR §4 escalation: after a verdict-disagreement save, offer
              a one-click hand-off to Make a rule for durable team-level
              intent. Free/Pro see the upsell variant; Team gets the
              modal. */}
          {plan === "team" && !ruleSaved && (
            <button
              type="button"
              onClick={() => setMakeRuleOpen(true)}
              className="text-xs font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
            >
              Make a rule for your team →
            </button>
          )}
        </div>
      )}

      {ruleSaved && (
        <p className="mt-3 text-xs text-emerald-700 dark:text-emerald-300">
          Rule saved. ContentRX will pin this string as a pass for your
          team.
        </p>
      )}

      <FindingAdjustModal
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        submittedText={submittedText}
        currentSuggestion={finding.suggestion ?? ""}
        issue={finding.issue}
        onSaved={(saved) => {
          setSavedState(saved);
          setAdjustOpen(false);
        }}
      />

      <FindingMakeRuleModal
        open={makeRuleOpen}
        onClose={() => setMakeRuleOpen(false)}
        submittedText={submittedText}
        issue={finding.issue}
        plan={plan}
        onSaved={() => {
          setRuleSaved(true);
          setMakeRuleOpen(false);
        }}
      />
    </li>
  );
}

/**
 * MakeRuleButton — gates between modal (Team plan) and upsell
 * affordance (Free/Pro). Per ADR 2026-04-29 §3 the button is always
 * visible; only the click action differs by plan.
 */
function MakeRuleButton({ plan, onOpen }: { plan: Plan; onOpen: () => void }) {
  if (plan === "team") {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label="Make a rule for your team"
        className="shrink-0 rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-200 dark:hover:bg-stone-900"
      >
        Make a rule
      </button>
    );
  }
  return (
    <Link
      href="/pricing#team"
      aria-label="Make a rule (Team plan)"
      className="shrink-0 rounded-md border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-medium text-stone-500 transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400 dark:hover:border-emerald-800 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-200"
    >
      Make a rule (Team)
    </Link>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  // Per ADR 2026-04-29 §9b — substrate severity (high/medium/low)
  // collapses to two visible customer tiers: high+medium → "Worth
  // adjusting" (amber), low → "Quick polish" (stone). The "Don't
  // ship" red tier is reserved for hard-rule findings, which the
  // schema 2.0 envelope doesn't carry yet (see humanize.ts for the
  // future signal). All findings ship through the default path.
  const { label, tone } = humanizeSeverity(severity);
  return <Pill tone={tone}>{label}</Pill>;
}

/**
 * CopySuggestionButton — copies the LLM's suggestion to the
 * clipboard, shows a brief "Copied" affordance, and dispatches the
 * cx-suggestion-copied event for the calibration substrate to pick
 * up later (Block 3a will wire the listener).
 *
 * Block 1b of the calibration plan.
 *
 * Failure mode: if `navigator.clipboard.writeText` rejects (rare;
 * happens in non-secure contexts or some embedded browsers), the
 * button shows "Couldn't copy" instead. We don't fall back to a
 * manual selection prompt — that's heavier than the failure case
 * deserves.
 */
function CopySuggestionButton({
  submittedText,
  suggestion,
  severity,
  confidence,
  issue,
}: {
  submittedText: string;
  suggestion: string;
  severity: string;
  confidence: number;
  issue: string;
}) {
  // "idle" → click → "copied" (or "error") → 2s timeout → "idle"
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(suggestion);
      setState("copied");
      dispatchSuggestionCopied({
        submittedText,
        suggestion,
        severity,
        confidence,
        issue,
      });
      // Block 3a (calibration plan): also fire-and-forget a POST so
      // the substrate gets a customer_copy row. Failure is silent —
      // the clipboard already succeeded; substrate accounting is
      // best-effort. The row is always share_upstream=false (passive
      // signal, no opt-in), so it stays team-private.
      void fetch("/api/calibration/copy-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submittedText,
          suggestion,
          severity,
          confidence,
          issue,
        }),
      }).catch(() => {
        // Swallowed — see comment above.
      });
    } catch {
      setState("error");
    }
  };

  const label =
    state === "copied"
      ? "Copied"
      : state === "error"
        ? "Couldn't copy"
        : "Copy suggestion";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Copy suggestion to clipboard"
      className={[
        "shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
        state === "copied"
          ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
          : state === "error"
            ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
            : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-200 dark:hover:bg-stone-900",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

/** Truncate a finding's issue text for display in the FlagForReview
 * modal's context line. The full issue can be a paragraph; the modal
 * just needs enough to identify which finding the customer is
 * flagging. */
function truncateForContext(text: string, max = 120): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max) + "...";
}
