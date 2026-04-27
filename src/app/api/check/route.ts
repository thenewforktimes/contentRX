/**
 * POST /api/check — the product's hot path.
 *
 * Flow (locked per BUILD_PLAN session 3):
 *   1. Auth (Clerk session OR CONTENTRX_API_KEY bearer)
 *   2. Load team rules (if user is on Team plan)
 *   3. Check monthly quota — 402 if exhausted
 *   4. Rate limit (60/min per user) — 429 if exceeded
 *   5. Call Python evaluator with text + content_type + audience + moment
 *   6. Apply team disabled-rule filter
 *   7. Log violations (sha256 only, no plaintext)
 *   8. Increment usage counter
 *   9. Return the result + quota metadata
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { publicCheckEnvelope } from "@/lib/api-envelope";
import { resolveAuth } from "@/lib/auth";
import {
  findMatchingExample,
  shortCircuitFromExample,
} from "@/lib/custom-examples";
import { appUrl as emailAppUrl, sendEmail } from "@/lib/email";
import { AUDIENCES, CONTENT_TYPES, MOMENTS } from "@/lib/engine-taxonomy";
import { evaluate, type EvaluateResponse } from "@/lib/evaluate";
import { hashText, logViolations } from "@/lib/log-violations";
import { currentMonth, monthlyQuota } from "@/lib/quotas";
import { checkRateLimit } from "@/lib/ratelimit";
import {
  applyAddedRules,
  applyDisabledFilter,
  applyOverrides,
  loadTeamRules,
  recomputeVerdict,
} from "@/lib/team-rules";
import { claimQuotaSlot, recordTokenUsage } from "@/lib/usage";
import { sanitizeZodIssues } from "@/lib/zod-errors";
import { QuotaExhaustedEmail } from "@/emails/quota-exhausted";
import { QuotaWarningEmail } from "@/emails/quota-warning";

// CORS: the Figma plugin iframe has Origin: null. We allow any origin
// because the request is gated on the Authorization header, not on
// cookies. No credentials, no Set-Cookie — so wildcard is safe.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, init?: ResponseInit): NextResponse {
  const res = NextResponse.json(body, init);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

const RequestSchema = z.object({
  // Engine enforces MAX_CONTENT_LENGTH=100_000; match that exactly.
  text: z.string().min(1).max(100_000),
  // content_type and moment go INTO the LLM system prompt verbatim.
  // Accepting arbitrary strings here is a prompt-injection vector.
  content_type: z.enum(CONTENT_TYPES).optional(),
  audience: z.enum(AUDIENCES).optional(),
  moment: z.enum(MOMENTS).optional(),
  source: z.enum(["plugin", "cli", "action", "ditto", "lsp", "mcp"]).default("plugin"),
  // Optional file_path, populated by the GitHub Action only. Upper
  // bound guards against repo paths that could swell the violations
  // table (typical paths are well under this).
  file_path: z.string().min(1).max(512).optional(),
});

export async function POST(req: Request) {
  const auth = await resolveAuth(req);
  if ("status" in auth) {
    return json({ error: auth.message }, { status: auth.status });
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: "Invalid request", issues: sanitizeZodIssues(parsed.error.issues) },
      { status: 400 },
    );
  }
  const { text, content_type, audience, moment, source, file_path } = parsed.data;

  const quota = monthlyQuota(auth.plan, auth.seats);

  // Rate-limit check first (cheap + purely time-based), then the
  // atomic quota claim. Order matters: we don't want rate-limited
  // callers to consume slots they can't actually use.
  const rl = await checkRateLimit(auth.user.id);
  if (!rl.success) {
    return json(
      {
        error: "Rate limit exceeded",
        reset_at: new Date(rl.reset).toISOString(),
      },
      {
        status: 429,
        headers: {
          "retry-after": String(Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000))),
        },
      },
    );
  }

  // Atomic claim: increments count by one ONLY if the user had room
  // under their plan's quota. A burst of concurrent requests can no
  // longer all squeeze past the cap (closes BE-M-04 / Known
  // Limitation #2 from the 2026-04-22 audit).
  const claim = await claimQuotaSlot(auth.user.id, quota);
  if (!claim.granted) {
    void notifyQuotaExhausted({
      to: auth.user.email,
      plan: auth.plan,
      quota,
      userId: auth.user.id,
    });
    return json(
      {
        error: "Monthly quota exhausted",
        quota,
        used: claim.count,
        plan: auth.plan,
        upgrade_url: `${appUrl()}/pricing?from=quota`,
        resets_at: monthResetISO(),
      },
      { status: 402 },
    );
  }
  const newUsed = claim.count;
  const remainingAfter = Math.max(0, quota - newUsed);
  if (remainingAfter <= warningThreshold(auth.plan, quota) && remainingAfter > 0) {
    void notifyQuotaWarning({
      to: auth.user.email,
      used: newUsed,
      quota,
      plan: auth.plan,
      userId: auth.user.id,
    });
  }

  const teamRules = await loadTeamRules(auth.teamOwnerUserId);

  // Human-eval build plan Session 30 — custom examples short-circuit.
  //
  // When the request belongs to a Team-plan user AND the normalized
  // text matches a team-authored custom example, skip the LLM entirely
  // and return the stored verdict. Quota still decrements (one request
  // = one slot, regardless of whether we called the LLM) but token
  // cost drops to zero for the matched case.
  //
  // Non-team requests (Free / Pro) skip this block — custom examples
  // are a Team-plan feature, and the `teamOwnerUserId` resolver
  // returns null for non-team users so the query would never match
  // anyway; we short-circuit the short-circuit for clarity.
  const teamOwnerForExamples =
    auth.plan === "team" ? (auth.teamOwnerUserId ?? auth.user.id) : null;
  let customExampleResult: Awaited<ReturnType<typeof findMatchingExample>> = null;
  if (teamOwnerForExamples) {
    try {
      customExampleResult = await findMatchingExample({
        teamOwnerUserId: teamOwnerForExamples,
        text,
        moment: moment ?? null,
        contentType: content_type ?? null,
      });
    } catch (err) {
      // Matching failures must never break a scan. Fall through to
      // the LLM path with a warning; Sentry catches it.
      console.error("findMatchingExample failed; falling through:", err);
    }
  }

  let evalResponse: EvaluateResponse;

  if (customExampleResult) {
    const sc = shortCircuitFromExample(customExampleResult);
    evalResponse = {
      result: {
        content_type: content_type ?? "unknown",
        overall_verdict: sc.overall_verdict,
        verdict: sc.verdict,
        review_reason: null,
        violations: sc.violations,
        passes: [],
        summary:
          sc.notes ?? "Matched a team custom example; LLM bypass.",
        audience: audience ?? "product_ui",
        moment: moment ?? customExampleResult.moment ?? "",
        pipeline: {},
        rationale_chain: [sc.rationale_hop],
      },
      latency_ms: 0,
      tokens: { input: 0, output: 0 },
    };
  } else {
    try {
      evalResponse = await evaluate({ text, content_type, audience, moment });
    } catch (err) {
      // Log detail to stderr (Sentry ingests via Vercel). Return an opaque
      // message to the caller — the Python-side error can include file paths,
      // model names, Anthropic error bodies, or a truncated LLM response.
      console.error("evaluate() failed:", err);
      return json(
        { error: "Evaluation service unavailable" },
        { status: 502 },
      );
    }
  }

  // Team-rule pipeline: disable first (strip), then override display fields
  // on the survivors, then append custom team-added rule matches, then
  // recompute verdict from the final violations list.
  // When a custom example fired, team rules still apply — an admin might
  // want to strip a rule that appears on the violations array attached
  // to a short-circuited violation-verdict entry.
  const disabled = applyDisabledFilter(evalResponse.result, teamRules.disabledStandardIds);
  const overridden = applyOverrides(disabled, teamRules.overridesByStandardId);
  const withAdds = applyAddedRules(overridden, text, teamRules.adds);
  const result = recomputeVerdict(withAdds);

  // Log + increment are observational — if they fail, the user still gets
  // their result. We surface the failure through Sentry, not to the user.
  try {
    // For team analytics: team_id is the team-owner's user.id regardless
    // of which team member ran the check. resolveAuth returns
    // teamOwnerUserId=null for the owner themselves (since their own
    // row's team_owner_user_id is null), so we promote user.id in that
    // case. Free/Pro users stay on teamId=null — they have no team to
    // roll up into.
    const teamIdForLog =
      auth.plan === "team"
        ? auth.teamOwnerUserId ?? auth.user.id
        : null;
    await logViolations({
      userId: auth.user.id,
      teamId: teamIdForLog,
      source,
      contentType: result.content_type ?? content_type ?? "unknown",
      moment: (result.moment as string | undefined) ?? moment ?? null,
      text,
      violations: result.violations,
      filePath: file_path ?? null,
      reviewReasonSubtype:
        (result as { review_reason?: string | null }).review_reason ?? null,
    });
  } catch (err) {
    console.error("logViolations failed:", err);
  }

  // Token-cost telemetry (audit M-24, PR 9). Roll up the engine's
  // reported token usage into the user's current-month usage row so
  // we can answer "how much did this customer cost us?" without
  // walking engine logs. Best-effort: a failure here doesn't fail the
  // request — the user already got their result and quota was already
  // counted.
  try {
    await recordTokenUsage(auth.user.id, {
      inputTokens: evalResponse.tokens.input,
      outputTokens: evalResponse.tokens.output,
      cacheReadInputTokens: evalResponse.tokens.cache_read_input ?? 0,
      cacheCreationInputTokens: evalResponse.tokens.cache_creation_input ?? 0,
    });
  } catch (err) {
    console.error("recordTokenUsage failed:", err);
  }

  // Public envelope (schema 2.0.0). `result` is the substrate
  // CheckResult shape returned by the Python engine; we project it
  // down to the four-field public Violation envelope and drop
  // substrate top-level fields (`passes`, `pipeline`, `moment`,
  // `audience`, `content_type`, `summary`, `overall_verdict`,
  // `rationale_chain`). The PUBLIC_TAXONOMY env var (default false)
  // controls whether substrate Violation fields surface inline for
  // reversibility — see `decisions/2026-04-25-private-taxonomy-pivot.md`.
  // API-usage telemetry (`latency_ms`, `tokens`, `usage`) is request
  // metadata, not taxonomy, and lives alongside the envelope.
  return json({
    ...publicCheckEnvelope(result),
    latency_ms: evalResponse.latency_ms,
    tokens: evalResponse.tokens,
    usage: {
      plan: auth.plan,
      used: newUsed,
      quota,
      remaining: Math.max(0, quota - newUsed),
      month: currentMonth(),
      text_hash: hashText(text),
    },
  });
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function monthResetISO(): string {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return next.toISOString();
}

function warningThreshold(plan: "free" | "pro" | "team", quota: number): number {
  // Free plan emails when 5 scans remain (matches the in-plugin warning
  // banner threshold). Paid plans use 10% of quota with a floor of 10
  // so a 5,000-scan plan still gets a heads-up before the wall.
  return plan === "free" ? 5 : Math.max(10, Math.round(quota * 0.1));
}

async function notifyQuotaWarning(args: {
  to: string;
  used: number;
  quota: number;
  plan: "free" | "pro" | "team";
  userId: string;
}) {
  try {
    await sendEmail({
      to: args.to,
      subject: `Heads up — ${Math.max(0, args.quota - args.used)} ContentRX checks left this month`,
      react: QuotaWarningEmail({
        appUrl: emailAppUrl(),
        used: args.used,
        quota: args.quota,
        plan: args.plan,
      }),
      dedupeKey: `warning:${args.userId}:${currentMonth()}`,
    });
  } catch (err) {
    console.warn("quota-warning email failed", err);
  }
}

async function notifyQuotaExhausted(args: {
  to: string;
  plan: "free" | "pro" | "team";
  quota: number;
  userId: string;
}) {
  try {
    await sendEmail({
      to: args.to,
      subject: "You've hit this month's ContentRX limit",
      react: QuotaExhaustedEmail({
        appUrl: emailAppUrl(),
        quota: args.quota,
        plan: args.plan,
        resetsAt: new Date(monthResetISO()).toLocaleDateString(undefined, {
          month: "long",
          day: "numeric",
        }),
      }),
      dedupeKey: `exhausted:${args.userId}:${currentMonth()}`,
    });
  } catch (err) {
    console.warn("quota-exhausted email failed", err);
  }
}
