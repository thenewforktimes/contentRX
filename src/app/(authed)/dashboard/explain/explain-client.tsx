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
import { Button, buttonStyles } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import type { PublicCheckEnvelope, PublicViolation } from "@/lib/api-envelope";
import { MAX_INPUT_CHARS, isLargeInput, meter } from "@/lib/metering";
import type { Plan } from "@/lib/quotas";
import {
  humanizeContentType,
  humanizeMoment,
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<CheckError | null>(null);
  const [response, setResponse] = useState<CheckEnvelope | null>(null);
  // Schema 3.0.0 (2026-05-05) collapsed the three-tier model
  // (Standard / Document / Surface) into length-routed sizing. The
  // tier selector UI is gone; the engine derives size from text
  // length and the dashboard's rendering branches on
  // `isLargeInput(submittedText)`.

  async function onCheck() {
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, source: "dashboard" }),
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
      const data = (await res.json()) as Omit<
        CheckEnvelope,
        "submittedText"
      >;
      // Capture the text we just submitted so the result renderer
      // branches on the input length we actually checked (not the
      // current textarea contents the user may have edited since), and
      // DiffBlock renders against a stable "before" even if the user
      // keeps editing the textarea afterward.
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

  const decision = meter(text);
  const overLimit = text.length > MAX_INPUT_CHARS;

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <label
          htmlFor="explain-text"
          className="block text-sm font-medium text-default"
        >
          Text to evaluate
        </label>
        <textarea
          id="explain-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="Try pasting a button label, an error message, or a paragraph from your latest PR"
          className={`w-full rounded-md border bg-white px-3 py-2 font-mono text-sm text-stone-900 focus:outline-none focus:ring-1 dark:bg-stone-950 dark:text-stone-100 ${
            overLimit
              ? "border-rose-500 focus:border-rose-500 focus:ring-rose-500"
              : "border-stone-300 focus:border-stone-500 focus:ring-neutral-500 dark:border-stone-700"
          }`}
        />
        <div className="flex items-center justify-between gap-3 text-xs">
          <span
            className={`tabular-nums ${
              overLimit
                ? "text-rose-600 dark:text-rose-400"
                : text.length > MAX_INPUT_CHARS * 0.9
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-default"
            }`}
          >
            {text.length.toLocaleString()} characters
            {text.length > 0 && (
              <>
                {" · "}
                <strong className="font-semibold">
                  {decision.unitsConsumed}{" "}
                  {decision.unitsConsumed === 1 ? "unit" : "units"}
                </strong>
              </>
            )}
          </span>
          {overLimit ? (
            <span className="text-right text-rose-600 dark:text-rose-400">
              Too long. Split into pieces ≤{" "}
              {MAX_INPUT_CHARS.toLocaleString()} chars, or use{" "}
              <Link href="/install" className="underline underline-offset-2">
                another surface →
              </Link>
            </span>
          ) : (
            <span className="text-default">
              1 unit per 200 characters
            </span>
          )}
        </div>
        <Button
          onClick={onCheck}
          disabled={loading || text.trim().length === 0 || overLimit}
        >
          {loading ? "Checking…" : "Check"}
        </Button>
      </section>

      {error && <ErrorBlock error={error} />}

      {response &&
        (isLargeInput(response.submittedText) ? (
          <DocumentReviewResult response={response} plan={plan} />
        ) : (
          <section className="space-y-4">
            <VerdictHeader
              verdict={response.verdict}
              findingCount={response.violations.length}
              contentType={response.content_type}
              moment={response.moment}
              submittedText={response.submittedText}
            />
            {response.violations.length > 0 ? (
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
            ) : response.verdict === "review_recommended" ? (
              <ReviewReasonFallback reviewReason={response.review_reason} />
            ) : null}
            <p className="pt-2 text-xs text-quiet">
              Evaluated in {response.latency_ms} ms.
            </p>
          </section>
        ))}
    </div>
  );
}

function VerdictHeader({
  verdict,
  findingCount,
  contentType,
  moment,
  submittedText,
}: {
  verdict: string;
  findingCount: number;
  contentType: string | null;
  moment: string | null;
  submittedText: string;
}) {
  // Per ADR 2026-04-29 §9a — customer surface speaks "Findings" /
  // "All clear" / "Worth a look" / "N findings to adjust", not raw
  // substrate verdict enums. Rendering goes through humanizeVerdict
  // at the boundary; the same helper is shared by every customer
  // surface (web, MCP, CLI, GitHub Action, LSP, Figma plugin) so the
  // language is identical wherever findings render.
  //
  // The review_reason was historically rendered next to the pill but
  // its labels (e.g. "Worth a closer look. We're not certain") echoed
  // and contradicted the pill ("Worth a look") — two restatements of
  // the same hedge with no new information. Dropped from this header
  // entirely; if a customer wants the why, they can flag the finding
  // for review and see the rationale on the admin side.
  const { label, tone } = humanizeVerdict(verdict, findingCount);
  // Schema 2.2.0 — surface the engine's classification of the
  // customer's input so recommendations feel grounded in the
  // specific situation. "Detected as a button label · destructive
  // confirmation" is more useful than a verdict pill alone because
  // it tells the customer WHICH lens the engine read their copy
  // through. Both fields are nullable from the engine; we render
  // only what's present.
  const contentTypeLabel = humanizeContentType(contentType);
  const momentLabel = humanizeMoment(moment);
  const showContext =
    contentTypeLabel.length > 0 || momentLabel.length > 0;
  // Verdict-level flag is most useful when there are zero findings —
  // "you said all clear but I think you missed something." When there
  // ARE findings, each FindingCard has its own per-finding Flag button
  // (more specific). Putting the flag link in the same visual block as
  // the verdict pill puts the disagree action one glance away from the
  // thing you'd disagree with — the previous footer-row placement
  // forced a scan to the bottom of the response.
  const flagVerdict =
    verdict === "pass" ||
    verdict === "violation" ||
    verdict === "review_recommended"
      ? verdict
      : null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Pill tone={tone}>{label}</Pill>
        <FlagForReview
          text={submittedText}
          verdict={flagVerdict}
          source="dashboard"
        />
      </div>
      {showContext && (
        <p className="text-xs text-quiet">
          Detected as{" "}
          {contentTypeLabel && (
            <span className="font-medium text-default">
              {contentTypeLabel.toLowerCase()}
            </span>
          )}
          {contentTypeLabel && momentLabel && " · "}
          {momentLabel && (
            <span className="font-medium text-default">
              {momentLabel.toLowerCase()}
            </span>
          )}
          .
        </p>
      )}
    </div>
  );
}

/**
 * Document-tier result renderer. Built to fix the per-finding-shows-the-
 * whole-document antipattern that the standard-tier DiffBlock pattern
 * produces when applied to a 5K-char input. Shape:
 *
 *   1. VerdictHeader   — reused; carries the customer-grounding line.
 *   2. SummaryCard     — counts + severity breakdown.
 *   3. SuggestedRewrite — the holistic clean version (Schema 2.3.0).
 *      The named-expert moat made visible.
 *   4. FindingsList    — issue + tight suggestion text per finding.
 *      NO per-finding diff against the whole document.
 *   5. View original    — collapsed disclosure with the input.
 *
 * The original DiffBlock pattern is deliberately NOT used here. For
 * Document tier, the rewrite IS the diff visualization; per-finding
 * suggestions are receipts of what changed and why.
 */
function DocumentReviewResult({
  response,
  plan,
}: {
  response: CheckEnvelope;
  plan: Plan;
}) {
  const findingCount = response.violations.length;
  const severityCounts = {
    high: response.violations.filter((v) => v.severity === "high").length,
    medium: response.violations.filter((v) => v.severity === "medium")
      .length,
    low: response.violations.filter((v) => v.severity === "low").length,
  };

  return (
    <section className="space-y-4">
      {/*
        v2.2: verdict block sticks to the top of the viewport while the
        user scrolls through the rewrite + findings. The "lose context"
        complaint had two roots — (a) the verdict went out of view as
        the user scrolled into findings, and (b) the findings lived in
        a flat list with no anchor back to the source. Sticky verdict
        addresses (a); category grouping + inline excerpts in
        DocumentFindingRow address (b). top-2 leaves a small breathing
        gap above the viewport edge so the card doesn't read as
        flush-bonded to the chrome.
      */}
      <div className="sticky top-2 z-10">
        <DocumentVerdictBlock
          verdict={response.verdict}
          findingCount={findingCount}
          worthAdjusting={
            severityCounts.high + severityCounts.medium
          }
          quickPolish={severityCounts.low}
          diagnostic={response.suggested_diagnostic}
          submittedText={response.submittedText}
        />
      </div>

      {response.suggested_rewrite && (
        <SuggestedRewriteBlock
          rewrite={response.suggested_rewrite}
          original={response.submittedText}
        />
      )}

      {findingCount > 0 ? (
        <DocumentFindingsList
          findings={response.violations}
          submittedText={response.submittedText}
          plan={plan}
        />
      ) : response.verdict === "review_recommended" ? (
        <ReviewReasonFallback reviewReason={response.review_reason} />
      ) : null}

      {/*
        v2.2: single Make-a-rule pitch at the bottom (Pro/Free only).
        Replaces the per-finding ghost button that was reading as a
        broken paid feature.
      */}
      {plan !== "team" && findingCount > 0 && (
        <p className="text-sm text-default">
          Have rules you want enforced for your team?{" "}
          <Link
            href="/pricing#team"
            className="font-medium text-accent-affirm-text underline underline-offset-2 hover:text-accent-affirm-on"
          >
            Upgrade to Team →
          </Link>
        </p>
      )}

      <ViewOriginalDisclosure original={response.submittedText} />

      <p className="pt-2 text-xs text-quiet">
        Evaluated in {response.latency_ms} ms.
      </p>
    </section>
  );
}

/**
 * Document-tier verdict block — schema 2.4.0 unified header.
 *
 * Combines what were previously three separate UI elements (verdict
 * pill, Flag-for-review link, summary card) into a single bordered
 * card. Per the doc-tier v2.1 critique:
 *
 *   - The previous split read as floating islands above the rewrite.
 *   - "Detected as long form copy · moment" was meta-info that
 *     competed with the actual artifact and confidently surfaced
 *     classifier hallucinations (e.g. a jargon doc reading as
 *     "celebration"). Dropped on Document tier; Standard tier still
 *     uses it through VerdictHeader.
 *   - Flag-for-review now reads as a peer of the verdict (proper
 *     contrast, button styling), not a faded link.
 *   - The diagnostic answers "what's broadly wrong?" so the customer
 *     doesn't have to scan all findings to decide whether to invest
 *     time in the rewrite.
 */
function DocumentVerdictBlock({
  verdict,
  findingCount,
  worthAdjusting,
  quickPolish,
  diagnostic,
  submittedText,
}: {
  verdict: string;
  findingCount: number;
  worthAdjusting: number;
  quickPolish: number;
  diagnostic: string | null;
  submittedText: string;
}) {
  const { label, tone } = humanizeVerdict(verdict, findingCount);
  const flagVerdict =
    verdict === "pass" ||
    verdict === "violation" ||
    verdict === "review_recommended"
      ? verdict
      : null;
  return (
    <div className="rounded-md border border-line bg-raised p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Pill tone={tone}>{label}</Pill>
          {findingCount > 0 && (
            <span className="text-sm text-default">
              <span className="font-semibold">{findingCount}</span>{" "}
              {findingCount === 1 ? "finding" : "findings"}
              {worthAdjusting > 0 && (
                <>
                  {" · "}
                  <span className="font-medium">{worthAdjusting}</span>{" "}
                  worth adjusting
                </>
              )}
              {quickPolish > 0 && (
                <>
                  {worthAdjusting > 0 ? ", " : " · "}
                  <span className="font-medium">{quickPolish}</span> quick
                  polish
                </>
              )}
            </span>
          )}
        </div>
        <FlagForReview
          text={submittedText}
          verdict={flagVerdict}
          source="dashboard"
        />
      </div>
      {diagnostic && (
        <p className="mt-2 text-sm text-default">{diagnostic}</p>
      )}
    </div>
  );
}

function SuggestedRewriteBlock({
  rewrite,
  original,
}: {
  rewrite: string;
  original: string;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  // v2.2: viewMode toggle. "clean" renders the rewrite as prose;
  // "diff" renders an inline word-diff against the original so the
  // customer can verify what changed before committing. The toggle
  // visual is a slider pill — the v2.1 segmented control didn't read
  // as toggleable per Robert's correction.
  const [viewMode, setViewMode] = useState<"clean" | "diff">("clean");

  useEffect(() => {
    if (copyState === "idle") return;
    const t = setTimeout(() => setCopyState("idle"), 2000);
    return () => clearTimeout(t);
  }, [copyState]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(rewrite);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  const copyLabel =
    copyState === "copied"
      ? "Copied"
      : copyState === "error"
        ? "Couldn't copy"
        : "Copy clean version";

  return (
    <div className="overflow-hidden rounded-md border border-accent-affirm-border bg-accent-affirm-soft">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-accent-affirm-border px-4 py-3">
        {/*
          Header copy is intentionally minimal. The earlier subtitle
          ("A cleaned version in the ContentRX house voice…") leaked
          a framing we don't believe in — ContentRX doesn't impose a
          house voice, it applies discernment to the customer's own
          content. Robert's correction (2026-05-05): "It's their
          content and our discernment, we don't have a house voice."
          Tight, neutral subtitle keeps the focus on the artifact.
        */}
        <div>
          <h3 className="text-sm font-semibold text-accent-affirm-text">
            Suggested rewrite
          </h3>
          <p className="mt-0.5 text-xs text-accent-affirm-text/80">
            Your document, edited for clarity.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/*
            Hierarchy: Clean / Diff are tertiary view-state toggles
            (ghost-style — text only, no chrome on inactive); Copy
            clean version is the single primary action (filled affirm,
            opacity-only hover so we never color-flip text on hover and
            re-create the dark-on-dark legibility bug).
          */}
          <div role="radiogroup" aria-label="Rewrite view mode" className="flex items-center gap-1">
            <button
              type="button"
              role="radio"
              aria-checked={viewMode === "clean"}
              onClick={() => setViewMode("clean")}
              className={[
                "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                viewMode === "clean"
                  ? "bg-overlay text-strong"
                  : "text-quiet hover:text-strong",
              ].join(" ")}
            >
              Clean
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={viewMode === "diff"}
              onClick={() => setViewMode("diff")}
              className={[
                "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                viewMode === "diff"
                  ? "bg-overlay text-strong"
                  : "text-quiet hover:text-strong",
              ].join(" ")}
            >
              Diff
            </button>
          </div>
          <button
            type="button"
            onClick={onCopy}
            aria-label="Copy clean version to clipboard"
            className={[
              "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-opacity",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
              copyState === "error"
                ? "bg-accent-caution-solid text-accent-caution-on"
                : "bg-accent-affirm-solid text-accent-affirm-on hover:opacity-90",
            ].join(" ")}
          >
            {copyLabel}
          </button>
        </div>
      </header>
      <div className="bg-raised px-4 py-3">
        {viewMode === "clean" ? (
          <pre className="whitespace-pre-wrap break-words font-sans text-sm text-strong">
            {rewrite}
          </pre>
        ) : (
          <RewriteDiffView before={original} after={rewrite} />
        )}
      </div>
    </div>
  );
}

/**
 * Block-level diff renderer for the Suggested rewrite "Diff" view.
 *
 * Reuses the existing `wordDiff` library (same algorithm Standard
 * tier's per-finding cards use) but renders inline within a single
 * <pre> block at document scale. Removed words show with strikethrough
 * and red background; added words show with a green background.
 *
 * Performance note: wordDiff is O(n * m) on token counts. At our 50K
 * char ceiling that's ~10K tokens per side; comfortably under
 * any user-facing latency threshold.
 */
function RewriteDiffView({ before, after }: { before: string; after: string }) {
  const tokens = wordDiff(before, after);
  return (
    <pre className="whitespace-pre-wrap break-words font-sans text-sm text-strong">
      {tokens.map((t, i) => {
        if (t.kind === "equal") return <span key={i}>{t.text}</span>;
        if (t.kind === "removed") {
          return (
            <span
              key={i}
              className="bg-red-100 text-red-900 line-through dark:bg-red-950/60 dark:text-red-300"
            >
              {t.text}
            </span>
          );
        }
        return (
          <span
            key={i}
            className="bg-green-100 text-green-900 dark:bg-green-950/60 dark:text-green-300"
          >
            {t.text}
          </span>
        );
      })}
    </pre>
  );
}

// Customer-facing category order. Defines render order; categories
// not in this list (defensive default if the engine ever emits a new
// label) sort to the end alphabetically. "Big picture" leads because
// document-shape observations are the highest-leverage things to
// engage with — they shape the user's read of the rest.
const CATEGORY_ORDER: ReadonlyArray<string> = [
  "Big picture",
  "Voice & tone",
  "Mechanics",
  "Structure",
  "Accessibility",
  "Inclusion",
];

/**
 * Group findings by their `category` field (schema 2.5.0). Returns
 * an ordered array of [category, findings[]] tuples, with categories
 * sorted by CATEGORY_ORDER. Empty categories are dropped — the user
 * sees only categories that have findings.
 */
function groupFindingsByCategory(
  findings: PublicViolation[],
): Array<[string, PublicViolation[]]> {
  const buckets = new Map<string, PublicViolation[]>();
  for (const f of findings) {
    const cat = f.category || "Big picture";
    const list = buckets.get(cat) ?? [];
    list.push(f);
    buckets.set(cat, list);
  }
  const ordered: Array<[string, PublicViolation[]]> = [];
  for (const cat of CATEGORY_ORDER) {
    const list = buckets.get(cat);
    if (list && list.length > 0) {
      ordered.push([cat, list]);
      buckets.delete(cat);
    }
  }
  // Defensive: any unexpected category (forward-compat with new engine
  // outputs) lands at the end alphabetically.
  for (const cat of Array.from(buckets.keys()).sort()) {
    ordered.push([cat, buckets.get(cat)!]);
  }
  return ordered;
}

/**
 * Extract a one-line excerpt from the original document for a
 * finding. Heuristic: the finding's `issue` text usually quotes the
 * offending token in single quotes ("'Two' should be a numeral",
 * "Repeated word: 'in in'", "ContentRX noticed 'touch' here..."). We
 * pull out the first quoted token, find its first occurrence in the
 * source, and return ±60 chars surrounding with ellipsis padding.
 *
 * Returns null when the issue text doesn't carry a quoted token, or
 * when the token isn't found in the source. Document-level findings
 * (Big picture category — incoherence, idioms, walls of text) don't
 * carry quoted tokens and intentionally have no excerpt.
 */
function extractExcerpt(
  issue: string,
  originalText: string,
): string | null {
  const quoted = /'([^']+)'/.exec(issue);
  if (!quoted) return null;
  const token = quoted[1];
  if (!token) return null;
  let pos = originalText.indexOf(token);
  if (pos === -1) {
    pos = originalText.toLowerCase().indexOf(token.toLowerCase());
  }
  if (pos === -1) return null;
  const start = Math.max(0, pos - 60);
  const end = Math.min(originalText.length, pos + token.length + 60);
  let excerpt = originalText.slice(start, end).trim();
  if (start > 0) excerpt = "…" + excerpt;
  if (end < originalText.length) excerpt = excerpt + "…";
  return excerpt;
}

function DocumentFindingsList({
  findings,
  submittedText,
  plan,
}: {
  findings: PublicViolation[];
  submittedText: string;
  plan: Plan;
}) {
  const groups = groupFindingsByCategory(findings);
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-default">
          Findings ({findings.length})
        </h3>
        <p className="mt-0.5 text-xs text-quiet">
          What changed and why. Each finding fired against the original
          document; the rewrite above already incorporates them.
        </p>
      </div>
      <div className="space-y-2">
        {groups.map(([category, items], idx) => (
          <DocumentFindingsCategory
            key={category}
            category={category}
            findings={items}
            submittedText={submittedText}
            plan={plan}
            // Big picture (the first group when present) opens by default —
            // those are the load-bearing observations. Other categories
            // collapse so the user can navigate without a wall of cards.
            defaultOpen={idx === 0}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One category section in the findings list — collapsible <details>
 * with a count in the summary row. Big picture findings get a
 * flatter visual treatment (no Adjust action) because they're
 * document-shape observations, not anchored line edits.
 */
function DocumentFindingsCategory({
  category,
  findings,
  submittedText,
  plan,
  defaultOpen,
}: {
  category: string;
  findings: PublicViolation[];
  submittedText: string;
  plan: Plan;
  defaultOpen: boolean;
}) {
  const isBigPicture = category === "Big picture";
  return (
    <details
      open={defaultOpen}
      className="overflow-hidden rounded-md border border-line bg-raised"
    >
      <summary className="flex cursor-pointer select-none items-center justify-between px-4 py-3 text-sm font-medium text-default hover:bg-hover">
        <span>
          {category}{" "}
          <span className="text-quiet">({findings.length})</span>
        </span>
        <span aria-hidden className="text-xs text-quiet">▾</span>
      </summary>
      <ul className="space-y-2 border-t border-line bg-canvas p-3">
        {findings.map((v, i) => (
          <DocumentFindingRow
            key={i}
            finding={v}
            submittedText={submittedText}
            plan={plan}
            isBigPicture={isBigPicture}
          />
        ))}
      </ul>
    </details>
  );
}

/**
 * Per-finding row in the Document-tier findings list. Renders the
 * issue, an inline source excerpt (when one can be extracted from the
 * issue text), and the suggestion text. The action toolbar varies by
 * whether the finding is anchored (line edit) or document-shape (Big
 * picture observation). NEVER renders a DiffBlock against the whole
 * document — that's the antipattern the doc-tier redesign exists to
 * kill.
 *
 * Make-a-rule: per ADR 2026-04-29 §3, the button stays accessible to
 * Team-plan customers per-finding. On Pro/Free a single prose pitch
 * lives at the bottom of the findings list (DocumentReviewResult);
 * the per-row ghost button was removing that link from this row.
 */
function DocumentFindingRow({
  finding,
  submittedText,
  plan,
  isBigPicture,
}: {
  finding: PublicViolation;
  submittedText: string;
  plan: Plan;
  isBigPicture: boolean;
}) {
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [makeRuleOpen, setMakeRuleOpen] = useState(false);
  const excerpt = isBigPicture
    ? null
    : extractExcerpt(finding.issue, submittedText);

  return (
    <li className="rounded-md border border-line bg-raised p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <SeverityBadge severity={finding.severity} />
        <div className="flex shrink-0 items-center gap-2">
          {finding.suggestion && !isBigPicture && (
            <CopySuggestionButton
              submittedText={submittedText}
              suggestion={finding.suggestion}
              severity={finding.severity}
              confidence={finding.confidence}
              issue={finding.issue}
            />
          )}
          {!isBigPicture && (
            <button
              type="button"
              onClick={() => setAdjustOpen(true)}
              aria-label="Adjust this finding"
              className="shrink-0 rounded-md border border-line-strong bg-raised px-2.5 py-1 text-xs font-medium text-default transition-colors hover:bg-hover"
            >
              Adjust
            </button>
          )}
          <FlagForReview
            text={submittedText}
            verdict="violation"
            variant="card-action"
            source="dashboard"
            contextLine={`Flagging finding: "${truncateForContext(finding.issue)}"`}
          />
          {plan === "team" && (
            <MakeRuleButton
              plan={plan}
              onOpen={() => setMakeRuleOpen(true)}
            />
          )}
        </div>
      </div>
      {excerpt && (
        <p className="mt-2 rounded border border-line bg-canvas px-2 py-1 font-mono text-xs text-quiet">
          {excerpt}
        </p>
      )}
      <p className="mt-2 text-strong">{finding.issue}</p>
      {finding.suggestion && (
        <p className="mt-1 text-default">
          <span className="text-quiet">Suggestion: </span>
          {finding.suggestion}
        </p>
      )}

      <FindingAdjustModal
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        submittedText={submittedText}
        currentSuggestion={finding.suggestion ?? ""}
        issue={finding.issue}
        onSaved={() => {
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
          setMakeRuleOpen(false);
        }}
      />
    </li>
  );
}

function ViewOriginalDisclosure({ original }: { original: string }) {
  return (
    <details className="rounded-md border border-line bg-raised text-sm">
      <summary className="cursor-pointer select-none px-4 py-3 font-medium text-default hover:text-strong">
        View original document
      </summary>
      <div className="border-t border-line px-4 py-3">
        <pre className="whitespace-pre-wrap break-words font-mono text-xs text-default">
          {original}
        </pre>
      </div>
    </details>
  );
}

function ReviewReasonFallback({
  reviewReason,
}: {
  reviewReason: string | null;
}) {
  const label = humanizeReviewReason(reviewReason);
  const explanation =
    label.length > 0
      ? label
      : "We elevated this for review but didn't land on a specific suggestion";
  return (
    <div className="rounded-md border border-line bg-raised p-4 text-sm text-default">
      <p>{explanation}.</p>
      <p className="mt-2 text-quiet">
        No concrete edit this time. Your judgment matters here. Flag it
        above if you want a second look.
      </p>
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
          className="select-none text-quiet"
        >
          −
        </span>
        <span className="break-words text-default">
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
          className="select-none text-quiet"
        >
          +
        </span>
        <span className="break-words text-default">
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
  const cautionBox =
    "flex flex-col gap-2 rounded-md border border-accent-caution-border bg-accent-caution-soft p-4 text-sm text-accent-caution-text";
  const concernBox =
    "flex flex-col gap-2 rounded-md border border-accent-concern-border bg-accent-concern-soft p-4 text-sm text-accent-concern-text";

  if (error.kind === "quota") {
    const resetDay = error.resetsAt ? formatResetDate(error.resetsAt) : null;
    return (
      <div role="alert" className={cautionBox}>
        <h3 className="font-semibold">Monthly limit reached</h3>
        <p>
          You&apos;ve used all {error.quota.toLocaleString()} checks for this
          month
          {resetDay ? `. Resets ${resetDay}` : ""}.
        </p>
        <Link
          href="/pricing?from=quota"
          className={buttonStyles({ variant: "warning", size: "sm", className: "self-start" })}
        >
          View plans
        </Link>
      </div>
    );
  }
  if (error.kind === "auth") {
    return (
      <div role="alert" className={concernBox}>
        <h3 className="font-semibold">Session expired</h3>
        <p>You were signed out. Refresh the page to sign back in.</p>
      </div>
    );
  }
  if (error.kind === "rate_limit") {
    const seconds = error.retryAfterSeconds;
    return (
      <div role="alert" className={cautionBox}>
        <h3 className="font-semibold">Hold on a sec</h3>
        <p>
          Too many checks too fast
          {seconds ? `. Try again in ${seconds}s` : ", try again in a moment"}.
        </p>
      </div>
    );
  }
  if (error.kind === "server") {
    return (
      <div role="alert" className={concernBox}>
        <h3 className="font-semibold">Something broke on our end</h3>
        <p>
          The check service hit an error. Try again. If it keeps happening,
          it&apos;s on us.
        </p>
      </div>
    );
  }
  if (error.kind === "network") {
    return (
      <div role="alert" className={concernBox}>
        <h3 className="font-semibold">Couldn&apos;t reach the check service</h3>
        <p>Check your connection and try again.</p>
      </div>
    );
  }
  // unknown: render the upstream message but in a readable shape.
  return (
    <div role="alert" className={concernBox}>
      <h3 className="font-semibold">Couldn&apos;t complete the check</h3>
      <p>{error.message}</p>
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
    <li className="rounded-md border border-line bg-white p-3 text-sm dark:bg-stone-900">
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
            className="shrink-0 rounded-md border border-line-strong bg-raised px-2.5 py-1 text-xs font-medium text-stone-700 transition-colors hover:bg-hover dark:text-stone-200"
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
      <p className="mt-2 text-strong">{finding.issue}</p>
      {finding.suggestion && (
        <DiffBlock before={submittedText} after={finding.suggestion} />
      )}

      {savedState?.rewriteText && (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50/50 px-3 py-2 dark:border-emerald-900 dark:bg-emerald-950/20">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
            Your version
          </p>
          <p className="mt-1 text-sm text-strong">
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
        className="shrink-0 rounded-md border border-line-strong bg-raised px-2.5 py-1 text-xs font-medium text-stone-700 transition-colors hover:bg-hover dark:text-stone-200"
      >
        Make a rule
      </button>
    );
  }
  return (
    <Link
      href="/pricing#team"
      aria-label="Make a rule (Team plan)"
      className="shrink-0 rounded-md border border-line bg-overlay px-2.5 py-1 text-xs font-medium text-quiet transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 dark:hover:border-emerald-800 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-200"
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
