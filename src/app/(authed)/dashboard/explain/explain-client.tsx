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
import { useState } from "react";
import type { PublicCheckEnvelope } from "@/lib/api-envelope";
import { wordDiff, type DiffToken } from "@/lib/text-diff";
import { dispatchCheckCompleted } from "../dashboard-check-events";

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
};

// Mirrors the /api/check billing constants. Kept in sync by hand
// because TypeScript-importing zod schemas across the route boundary
// adds overhead for two numbers. If either number changes, update
// route.ts as well — the API enforces independently.
const CHARS_PER_CHECK = 5_000;
const MAX_CHECKS_PER_CALL = 5;
const MAX_CHECK_CHARS = CHARS_PER_CHECK * MAX_CHECKS_PER_CALL; // 25_000

/**
 * Proportional billing preview: 1 check per CHARS_PER_CHECK characters,
 * rounded up. Capped at MAX_CHECKS_PER_CALL so the live counter never
 * shows numbers larger than the API will accept.
 */
function checksFor(text: string): number {
  if (text.length === 0) return 0;
  return Math.min(MAX_CHECKS_PER_CALL, Math.ceil(text.length / CHARS_PER_CHECK));
}

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

export function ExplainClient() {
  const router = useRouter();
  const [text, setText] = useState(
    "Unable to complete operation. Please contact administrator.",
  );
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
      const data = (await res.json()) as CheckEnvelope;
      setResponse(data);
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

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <label
          htmlFor="explain-text"
          className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
        >
          Text to evaluate
        </label>
        <textarea
          id="explain-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          className={`w-full rounded-md border bg-white px-3 py-2 font-mono text-sm text-neutral-900 focus:outline-none focus:ring-1 dark:bg-neutral-950 dark:text-neutral-100 ${
            text.length > MAX_CHECK_CHARS
              ? "border-red-500 focus:border-red-500 focus:ring-red-500"
              : "border-neutral-300 focus:border-neutral-500 focus:ring-neutral-500 dark:border-neutral-700"
          }`}
        />
        <div className="flex items-center justify-between gap-3 text-xs">
          <span
            className={`tabular-nums ${
              text.length > MAX_CHECK_CHARS
                ? "text-red-600 dark:text-red-400"
                : text.length > MAX_CHECK_CHARS * 0.9
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-neutral-500 dark:text-neutral-300"
            }`}
          >
            {text.length.toLocaleString()} characters
            {text.length > 0 && (
              <>
                {" · "}
                <strong className="font-semibold">
                  {checksFor(text)}{" "}
                  {checksFor(text) === 1 ? "check" : "checks"}
                </strong>
              </>
            )}
          </span>
          {text.length > MAX_CHECK_CHARS ? (
            <span className="text-right text-red-600 dark:text-red-400">
              Too long. Split into pieces ≤ {MAX_CHECK_CHARS.toLocaleString()}{" "}
              chars or use{" "}
              <Link href="/install" className="underline underline-offset-2">
                MCP / GitHub Action →
              </Link>
            </span>
          ) : (
            <span className="text-neutral-500 dark:text-neutral-300">
              1 check per {CHARS_PER_CHECK.toLocaleString()} chars
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onCheck}
          disabled={
            loading ||
            text.trim().length === 0 ||
            text.length > MAX_CHECK_CHARS
          }
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-black"
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
          />
          {response.violations.length > 0 && (
            <ul className="space-y-2">
              {response.violations.map((v, i) => (
                <li
                  key={i}
                  className="rounded-md border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <SeverityBadge severity={v.severity} />
                  <p className="mt-2 text-neutral-900 dark:text-neutral-100">
                    {v.issue}
                  </p>
                  {v.suggestion && (
                    <DiffBlock before={text} after={v.suggestion} />
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-neutral-500 dark:text-neutral-300">
            Evaluated in {response.latency_ms} ms.
          </p>
        </section>
      )}
    </div>
  );
}

function VerdictHeader({
  verdict,
  reviewReason,
}: {
  verdict: string;
  reviewReason: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span
        className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
          verdict === "pass"
            ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
            : verdict === "review_recommended"
              ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
              : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
        }`}
      >
        {verdict}
      </span>
      {reviewReason && (
        <span className="text-sm text-neutral-600 dark:text-neutral-300">
          {reviewReason.replace(/_/g, " ")}
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
          className="select-none text-neutral-400 dark:text-neutral-600"
        >
          −
        </span>
        <span className="break-words text-neutral-700 dark:text-neutral-300">
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
          className="select-none text-neutral-400 dark:text-neutral-600"
        >
          +
        </span>
        <span className="break-words text-neutral-700 dark:text-neutral-300">
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
 * Tone matches Robo's voice (PR-42 vocabulary refactor):
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
          Monthly quota reached
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
          See plans
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
          Slow down
        </h3>
        <p className="text-amber-900 dark:text-amber-300">
          You&apos;re sending checks faster than the rate limit allows
          {seconds ? `. Try again in ${seconds}s` : ""}.
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
          The check service hit an error. Try again — if it keeps happening,
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

function SeverityBadge({ severity }: { severity: string }) {
  const tone =
    severity === "high"
      ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
      : severity === "medium"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
        : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tone}`}
    >
      {severity}
    </span>
  );
}
