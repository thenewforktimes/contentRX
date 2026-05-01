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

import { z } from "zod";
import { publicCheckEnvelope } from "@/lib/api-envelope";
import { revalidateDashboard } from "@/lib/revalidate";
import { resolveAuth } from "@/lib/auth";
import {
  checkCostPause,
  evaluateAndPauseIfExceeded,
  recordUsageEvent,
} from "@/lib/cost-monitor";
import { corsJson, corsPreflight } from "@/lib/cors";
import {
  findMatchingExample,
  shortCircuitFromExample,
} from "@/lib/custom-examples";
import { appUrl as emailAppUrl, sendEmail } from "@/lib/email";
import { AUDIENCES, CONTENT_TYPES, MOMENTS } from "@/lib/engine-taxonomy";
import { evaluate, type EvaluateResponse } from "@/lib/evaluate";
import { hashText, logViolations } from "@/lib/log-violations";
import {
  MAX_INPUT_CHARS,
  meter,
  meteringBlock,
  meterTierSchema,
} from "@/lib/metering";
import { fetchPrecedentsForCheck } from "@/lib/precedents";
import {
  detectSensitivePatterns,
  sensitiveDataErrorMessage,
} from "@/lib/pii-screen";
import { currentMonth, monthlyQuota, type Plan } from "@/lib/quotas";
import { logSafeError } from "@/lib/safe-error-log";
import { checkRateLimit } from "@/lib/ratelimit";
import {
  applyAddedRules,
  applyDisabledFilter,
  applyOverrides,
  loadTeamRules,
  recomputeVerdict,
} from "@/lib/team-rules";
import { teamScope } from "@/lib/team-scope";
import { claimQuotaSlots, recordTokenUsage } from "@/lib/usage";
import { sanitizeZodIssues } from "@/lib/zod-errors";
import { CostPauseAlertEmail } from "@/emails/cost-pause-alert";
import { QuotaExhaustedEmail } from "@/emails/quota-exhausted";
import { QuotaWarningEmail } from "@/emails/quota-warning";

// ----- billing model ---------------------------------------------------------
//
// Tier-aware metering (pre-pilot launch, schema 2.1.0). The /api/check
// route accepts an optional `segment_type` field; if absent, the call
// defaults to standard tier. The actual unit math lives in
// `src/lib/metering.ts` so the dashboard's real-time estimator can
// import the same function and stay in lock-step.
//
//   - standard (default): 1 unit per 300 characters of input, rounded
//                         up. A 50-char button label is 1 unit; a
//                         600-char paragraph is 2; a 1,500-char screen
//                         is 5.
//   - document: 8 units flat, regardless of length. Caller declares
//               this for end-to-end help articles, full empty states,
//               multi-paragraph onboarding flows.
//   - surface:  25 units flat. Caller declares this for full PR diffs,
//               complete Figma frames, multi-file content audits.
//
// Hard input ceiling is MAX_INPUT_CHARS = 50,000 across all tiers.
// Beyond that the caller splits into multiple calls.

// CORS allowlist (audit S5): see `lib/cors.ts`. The Figma plugin
// iframe sends `Origin: null`; the marketing site is same-origin to
// /api/*; we narrowed from `*` to figma + localhost-dev as defense-
// in-depth. Auth is the bearer header, never a cookie, so an origin
// that isn't on the list still can't forge an authenticated call.

export async function OPTIONS(req: Request) {
  return corsPreflight(req);
}

const RequestSchema = z.object({
  // Hard ceiling: MAX_INPUT_CHARS = 50,000 per call. Tier-aware
  // metering bills the call by `segment_type` (1 unit per 300 chars at
  // standard, 8 flat at document, 25 flat at surface). A single call
  // can cost from 1 unit (button label at standard) to 167 units
  // (50,000 chars at standard — economically silly, the caller would
  // declare surface for 25 units instead).
  //
  // Why a hard ceiling at 50,000 instead of letting the caller send
  // arbitrary length: defense-in-depth against runaway tokens reaching
  // Anthropic. The engine has its own MAX_CONTENT_LENGTH = 100,000 as
  // a backstop, but /api/check is the only public surface and bears
  // primary responsibility.
  //
  // Beyond 50,000 chars: callers must split into multiple calls.
  // Each surface (CLI, GitHub Action, MCP) implements split client-side
  // and submits per-batch. Future work may push this server-side via a
  // batch endpoint.
  text: z
    .string()
    .min(1)
    .max(MAX_INPUT_CHARS, {
      message:
        `Text is too long (max ${MAX_INPUT_CHARS.toLocaleString()} ` +
        `characters per call). ContentRX bills checks by tier — a ` +
        `standard check is 1 unit per 300 chars, document is 8 flat, ` +
        `surface is 25 flat. The same cap applies on every surface ` +
        `(web app, MCP, CLI, GitHub Action, Figma plugin). For copy ` +
        `longer than ${MAX_INPUT_CHARS.toLocaleString()} chars, split ` +
        `into multiple calls — MCP evaluate_copy_batch and the GitHub ` +
        `Action handle this client-side.`,
    }),
  // Optional billing tier. If absent, defaults to standard (per-300-char
  // proportional billing). Callers that already know the shape of their
  // input declare it explicitly:
  //   - MCP `evaluate_copy` → standard
  //   - MCP `evaluate_copy_batch` → document or surface based on size
  //   - Figma plugin → standard (one layer per call)
  //   - GitHub Action → surface (whole PR diff)
  //   - CLI: standard or document depending on the --batch flag
  segment_type: meterTierSchema.optional().default("standard"),
  // content_type and moment go INTO the LLM system prompt verbatim.
  // Accepting arbitrary strings here is a prompt-injection vector.
  content_type: z.enum(CONTENT_TYPES).optional(),
  audience: z.enum(AUDIENCES).optional(),
  moment: z.enum(MOMENTS).optional(),
  // Required: every official client (dashboard web app, figma plugin, CLI,
  // github action, LSP, MCP) sets this explicitly. The pre-pivot default was
  // "plugin", which silently misattributed every web-app and unauthenticated
  // test call to the Figma plugin counter. Dropped on 2026-04-28 — see the
  // surface-attribution fix PR. Rogue callers now get a 400 instead of
  // polluting analytics. "dashboard" matches the existing terminology in
  // violation_overrides + correction-feedback source enums.
  source: z.enum(["dashboard", "plugin", "cli", "action", "ditto", "lsp", "mcp"]),
  // Optional file_path, populated by the GitHub Action only. Upper
  // bound guards against repo paths that could swell the violations
  // table (typical paths are well under this).
  file_path: z.string().min(1).max(512).optional(),
  // PR-40 — optional run_id, populated by the GitHub Action with
  // GITHUB_RUN_ID. Groups every violation logged during the same
  // workflow run so /dashboard/runs/<run_id> can render a single
  // page summarizing the run. Tight regex: GitHub run IDs are
  // numeric, but we accept any reasonable identifier (callers
  // outside CI may want to use their own grouping key) — bounded to
  // keep the column compact and immune to UUID-style malformation
  // in URL paths.
  run_id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/, {
      message: "run_id must be alphanumeric with . _ -",
    })
    .optional(),
});

export async function POST(req: Request) {
  const json = (body: unknown, init?: ResponseInit) =>
    corsJson(req, body, init);
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
  const {
    text,
    content_type,
    audience,
    moment,
    source,
    file_path,
    run_id,
    segment_type,
  } = parsed.data;

  // PII pre-screen — refuse credit cards, SSNs, and credential-shaped
  // strings BEFORE they reach the engine, Anthropic, Sentry, or
  // function logs. Cheap regex pass; the matched value is never
  // echoed back. See `src/lib/pii-screen.ts`.
  const sensitivePatterns = detectSensitivePatterns(text);
  if (sensitivePatterns.length > 0) {
    return json(
      {
        error: sensitiveDataErrorMessage(sensitivePatterns),
        patterns: sensitivePatterns,
      },
      { status: 400 },
    );
  }

  // Cost-monitor pause check — Phase 4 of the pre-pilot launch build.
  // When a user crossed their daily/monthly cost threshold on a
  // previous call, the threshold-evaluation logic flipped
  // `cost_pause_active = true`. Subsequent calls 402 here until a
  // founder Resume from /admin/costs clears the flag. Defaults are
  // permissive ($50/day, $500/month) — this only fires on runaway
  // scripts or misconfigured CI loops, not normal heavy use.
  // Fail-closed: if the pause-check itself errors (DB outage, query
  // bug), default to paused. The whole point of cost-pause is fail-
  // safe runaway-cost protection; a transient DB error must NOT let
  // a possibly-paused account keep accruing charges. Healthy accounts
  // get a transient 402 during the outage; that's the correct
  // trade-off for a guardrail feature.
  const isPaused = await checkCostPause(auth.user.id).catch((err) => {
    logSafeError("checkCostPause failed; defaulting to paused", err);
    return true;
  });
  if (isPaused) {
    return json(
      {
        error:
          "Pilot account paused for review. Email Robo to resume.",
        paused: true,
      },
      { status: 402 },
    );
  }

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

  // Tier-aware quota claim. A 50-char button label at standard tier
  // costs 1 unit; a 600-char paragraph at standard costs 2; a 5,000-char
  // help article at document costs 8 flat; a 30,000-char PR diff at
  // surface costs 25 flat. The atomic claim is all-or-nothing — if the
  // user has 1 unit left and this call costs 8, we 402 without touching
  // the engine. Burst concurrency is still safe (the upsert + setWhere
  // guard composes the same way for n > 1).
  const meterDecision = meter(text, segment_type);
  const checksNeeded = meterDecision.unitsConsumed;
  const claim = await claimQuotaSlots(auth.user.id, checksNeeded, quota);
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
        checks_required: checksNeeded,
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
      logSafeError("findMatchingExample failed; falling through", err);
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
    // Block 2c (calibration plan): pull approved precedents matching
    // (moment, content_type) and pass them to the engine for voice-
    // guidance prompt injection. Empty array when no precedents
    // match — engine falls back to the universal voice rules from
    // PR #252.
    let precedents: Awaited<ReturnType<typeof fetchPrecedentsForCheck>> = [];
    try {
      precedents = await fetchPrecedentsForCheck({
        moment: moment ?? null,
        contentType: content_type ?? null,
      });
    } catch (err) {
      // Retrieval failure is non-fatal: log + continue without
      // precedents. The check still runs against the universal
      // voice rules.
      logSafeError("precedent retrieval failed", err);
    }

    try {
      evalResponse = await evaluate({
        text,
        content_type,
        audience,
        moment,
        precedents: precedents.map((p) => ({
          approved_text: p.approvedText,
          sample_size: p.sampleSize,
        })),
      });
    } catch (err) {
      // Log detail to stderr (Sentry ingests via Vercel). Return an opaque
      // message to the caller — the Python-side error can include file paths,
      // model names, Anthropic error bodies, or a truncated LLM response.
      logSafeError("evaluate() failed", err);
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

  // Log + token-usage + cost-event writes are observational — all run
  // in parallel since none depends on the others, and a failure in
  // any should never fail the request. The user already got their
  // result and quota was already counted at claimQuotaSlot time.
  // team_id always equals "team-owner-or-self" — see lib/team-scope.ts
  // for the full rationale. Centralized in `teamScope()` so writes and
  // reads always agree (PR-198 fix for the team_id NULL bug).
  const teamIdForLog = teamScope(auth);
  const tokens = {
    inputTokens: evalResponse.tokens.input,
    outputTokens: evalResponse.tokens.output,
    cacheReadInputTokens: evalResponse.tokens.cache_read_input ?? 0,
    cacheCreationInputTokens: evalResponse.tokens.cache_creation_input ?? 0,
  };
  const [logResult, tokenResult, eventResult] = await Promise.allSettled([
    logViolations({
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
      runId: run_id ?? null,
    }),
    recordTokenUsage(auth.user.id, tokens),
    // Phase 4 cost-monitor + check-history: one event row per /api/check
    // completion. The cost columns drive /admin/costs + the threshold-
    // evaluation pause logic. The check-history columns drive
    // /dashboard/checks — the customer-facing list of "what did I run?".
    // text_preview stores the first 80 chars of the input so customers
    // can recognise their own checks. Customer-not-product (ADR
    // 2026-04-28): the customer's own data, shown back to the customer,
    // is not aggregation. A future TTL will null text_preview after 90
    // days.
    recordUsageEvent({
      userId: auth.user.id,
      segmentType: meterDecision.tier,
      unitsConsumed: meterDecision.unitsConsumed,
      ...tokens,
      modelId: null,
      teamId: teamIdForLog,
      source,
      contentType: result.content_type ?? content_type ?? null,
      moment:
        (result.moment as string | undefined) ?? moment ?? null,
      verdict:
        (result as { verdict?: string | null }).verdict ?? null,
      reviewReason:
        (result as { review_reason?: string | null }).review_reason ?? null,
      violationCount: result.violations.length,
      textHash: hashText(text),
      textPreview: text.slice(0, 80),
    }),
  ]);
  if (logResult.status === "rejected") {
    logSafeError("logViolations failed", logResult.reason);
  }
  if (tokenResult.status === "rejected") {
    logSafeError("recordTokenUsage failed", tokenResult.reason);
  }
  if (eventResult.status === "rejected") {
    logSafeError("recordUsageEvent failed", eventResult.reason);
  } else {
    // Threshold evaluation runs after the event row lands so the new
    // call's spend is included in the daily/monthly sum. Errors here
    // are non-fatal — the next call's evaluation will catch the same
    // threshold cross. Don't await the email; the user response
    // doesn't depend on it.
    void evaluateAndPauseIfExceeded(auth.user.id)
      .then((result) => {
        if (result?.pausedNow) {
          void notifyCostPause({
            userEmail: auth.user.email,
            userId: auth.user.id,
            ...result,
          });
        }
      })
      .catch((err) => {
        logSafeError("evaluateAndPauseIfExceeded failed", err);
      });
  }

  // Bust the dashboard's edge cache + tag-cached loaders so the usage
  // counter, "This week" panel, and Active-Surfaces row reflect this
  // check on the next render. Scope: this user's usage, this team's
  // violations. See `lib/revalidate.ts` + `lib/cache-tags.ts`.
  revalidateDashboard({ userId: auth.user.id, teamId: teamIdForLog });

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
    // Schema 2.1.0: top-level metering block with the tier billed
    // (standard/document/surface), units consumed in standard-check
    // equivalents, raw character count, segment count (always 1 in
    // single-string regime), and split flag. Callers that don't read
    // `metering` keep working — `usage.checks_consumed` mirrors
    // `metering.units_consumed` for backwards-compatible consumers.
    metering: meteringBlock(meterDecision),
    usage: {
      plan: auth.plan,
      used: newUsed,
      quota,
      remaining: Math.max(0, quota - newUsed),
      // checks_consumed reflects the tier-aware billing for this
      // single call. Mirrors `metering.units_consumed`. Callers (web
      // app counter, MCP agents) use either to explain "this paste
      // cost you 8 units (document tier)" without re-implementing
      // the metering math client-side.
      checks_consumed: checksNeeded,
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

function warningThreshold(_plan: Plan, quota: number): number {
  // 2026-04-27: aligned the email + dashboard at 80% used (= 20%
  // remaining). Robert's call: gentle nudge as the customer approaches
  // the cap, same threshold across plans for consistency. Floor at 1
  // so tiny quotas (test fixtures, downgrades) still emit at least one
  // warning email before the wall.
  return Math.max(1, Math.round(quota * 0.2));
}

async function notifyQuotaWarning(args: {
  to: string;
  used: number;
  quota: number;
  plan: Plan;
  userId: string;
}) {
  try {
    await sendEmail({
      to: args.to,
      subject: `Heads up. ${Math.max(0, args.quota - args.used)} ContentRX checks left this month`,
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
  plan: Plan;
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

/**
 * Founder alert: a user crossed their daily/monthly cost threshold and
 * the cost monitor flipped `cost_pause_active`. Sends a Resend email
 * to the founder address (FOUNDER_EMAIL env var; falls back to
 * hello@contentrx.io) AND logs a structured warning to Vercel
 * function logs as a backstop so a Resend outage can't lose the
 * signal. The threshold-evaluator's atomic UPDATE guard de-dupes
 * re-pause attempts so this fires at most once per crossing.
 */
async function notifyCostPause(args: {
  userEmail: string;
  userId: string;
  dailySpendUsd: number;
  monthlySpendUsd: number;
  dailyThresholdUsd: number;
  monthlyThresholdUsd: number;
}) {
  const trigger: "daily" | "monthly" =
    args.dailySpendUsd >= args.dailyThresholdUsd ? "daily" : "monthly";
  // Backstop log — Sentry / Vercel function logs ingest this even if
  // Resend is unavailable. Keep this regardless of email success.
  console.warn(
    JSON.stringify({
      kind: "cost-pause",
      userId: args.userId,
      userEmail: args.userEmail,
      trigger,
      dailySpendUsd: args.dailySpendUsd,
      monthlySpendUsd: args.monthlySpendUsd,
      dailyThresholdUsd: args.dailyThresholdUsd,
      monthlyThresholdUsd: args.monthlyThresholdUsd,
      message: "Cost-pause triggered. Resume at /admin/costs.",
    }),
  );
  const founderEmail = process.env.FOUNDER_EMAIL ?? "hello@contentrx.io";
  try {
    await sendEmail({
      to: founderEmail,
      subject: `Cost-pause: ${args.userEmail} crossed the ${trigger} threshold`,
      react: CostPauseAlertEmail({
        userEmail: args.userEmail,
        userId: args.userId,
        dailySpendUsd: args.dailySpendUsd,
        monthlySpendUsd: args.monthlySpendUsd,
        dailyThresholdUsd: args.dailyThresholdUsd,
        monthlyThresholdUsd: args.monthlyThresholdUsd,
        trigger,
        appUrl: emailAppUrl(),
      }),
      // The threshold-evaluator's atomic UPDATE guard already de-dupes
      // re-pause attempts, so this won't fire twice for the same
      // crossing. No Redis dedupe key needed.
    });
  } catch (err) {
    logSafeError(
      "cost-pause email failed (backstop logged via console.warn)",
      err,
    );
  }
}
