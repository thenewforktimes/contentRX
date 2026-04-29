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
import { corsJson, corsPreflight } from "@/lib/cors";
import {
  findMatchingExample,
  shortCircuitFromExample,
} from "@/lib/custom-examples";
import { appUrl as emailAppUrl, sendEmail } from "@/lib/email";
import { AUDIENCES, CONTENT_TYPES, MOMENTS } from "@/lib/engine-taxonomy";
import { evaluate, type EvaluateResponse } from "@/lib/evaluate";
import { hashText, logViolations } from "@/lib/log-violations";
import { fetchPrecedentsForCheck } from "@/lib/precedents";
import {
  detectSensitivePatterns,
  sensitiveDataErrorMessage,
} from "@/lib/pii-screen";
import { currentMonth, monthlyQuota } from "@/lib/quotas";
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
import { QuotaExhaustedEmail } from "@/emails/quota-exhausted";
import { QuotaWarningEmail } from "@/emails/quota-warning";

// ----- billing model ---------------------------------------------------------
//
// One check = up to CHARS_PER_CHECK characters of input. Longer text is
// stepped: 3,001-6,000 chars = 2 checks, 6,001-9,000 = 3, etc. Hard
// ceiling at MAX_CHECK_CHARS = CHARS_PER_CHECK * MAX_CHECKS_PER_CALL.
//
// 3,000-char unit (re-anchored 2026-04-28): a generous editorial
// "paragraph" is 250-750 chars; 3,000 chars covers ~5 paragraphs, which
// is far more than any single tactical UI string. The 5,000 unit from
// the initial proportional rollout was overgenerous — most legitimate
// long-form copy fits comfortably in 3,000, and tighter unit means
// less cost-per-call exposure if a free user concatenates content.
//
// These constants ARE the contract. Change either and the API response,
// the web app counter (explain-client.tsx mirrors), and any client-side
// preview need to stay in sync.
const CHARS_PER_CHECK = 3_000;
const MAX_CHECKS_PER_CALL = 5;
const MAX_CHECK_CHARS = CHARS_PER_CHECK * MAX_CHECKS_PER_CALL; // 15_000

/** Proportional billing: 1 check per CHARS_PER_CHECK characters, rounded up. */
function checksFor(text: string): number {
  if (text.length === 0) return 0;
  return Math.min(MAX_CHECKS_PER_CALL, Math.ceil(text.length / CHARS_PER_CHECK));
}

// CORS allowlist (audit S5): see `lib/cors.ts`. The Figma plugin
// iframe sends `Origin: null`; the marketing site is same-origin to
// /api/*; we narrowed from `*` to figma + localhost-dev as defense-
// in-depth. Auth is the bearer header, never a cookie, so an origin
// that isn't on the list still can't forge an authenticated call.

export async function OPTIONS(req: Request) {
  return corsPreflight(req);
}

const RequestSchema = z.object({
  // Hard ceiling: 25,000 characters per call. Proportional billing
  // applies (1 check per 5,000 chars, see CHARS_PER_CHECK below) so a
  // single call can cost up to MAX_CHECKS_PER_CALL = 5 quota units.
  //
  // Why proportional instead of a flat 1-check-per-call cap:
  //   - A flat cap at 25,000 would let a Free user spend 1 check on a
  //     25,000-char block (~$0.25 in Anthropic input tokens). That's
  //     500x the leverage of a tactical 50-char button label and
  //     reintroduces the gaming vector PR-224 was designed to close.
  //   - Proportional billing makes the gamer's leverage equal to
  //     everyone else's: 1 check buys 5,000 chars, period. Long-form
  //     legitimate users (FAQ entries, error pages) pay for what they
  //     consume; nobody gets locked out for having 2,500-char copy.
  //
  // Same cap applies to every surface (web app, MCP, CLI, GitHub
  // Action, Figma plugin). The error message names them explicitly so
  // a user routed here from one surface knows the cap follows them.
  //
  // Engine's MAX_CONTENT_LENGTH=100_000 is unchanged — defense-in-depth
  // backstop if anything ever bypasses /api/check.
  text: z
    .string()
    .min(1)
    .max(MAX_CHECK_CHARS, {
      message:
        `Text is too long (max ${MAX_CHECK_CHARS.toLocaleString()} characters per check). ` +
        `ContentRX bills 1 check per ${CHARS_PER_CHECK.toLocaleString()} ` +
        `characters across every surface (web app, MCP, CLI, GitHub Action, ` +
        `Figma plugin). Even the batch tools enforce the per-string cap. ` +
        `For copy longer than ${MAX_CHECK_CHARS.toLocaleString()} chars, ` +
        `split it into separate strings and use MCP evaluate_copy_batch ` +
        `(each string still capped here) or the GitHub Action (extracts ` +
        `each source-file string individually).`,
    }),
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

  // Proportional quota claim. A 50-char button label still costs 1
  // check; a 7,500-char FAQ entry costs 2 checks; a 25,000-char doc
  // costs 5. The atomic claim is all-or-nothing — if the user has 1
  // check left and this call costs 2, we 402 without touching the
  // engine. Burst concurrency is still safe (the upsert + setWhere
  // guard composes the same way for n > 1).
  const checksNeeded = checksFor(text);
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

  // Log + token-usage writes are observational — both run in parallel
  // since neither depends on the other, and a failure in either should
  // never fail the request. The user already got their result and quota
  // was already counted at claimQuotaSlot time.
  // team_id always equals "team-owner-or-self" — see lib/team-scope.ts
  // for the full rationale. Centralized in `teamScope()` so writes and
  // reads always agree (PR-198 fix for the team_id NULL bug).
  const teamIdForLog = teamScope(auth);
  const [logResult, tokenResult] = await Promise.allSettled([
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
    recordTokenUsage(auth.user.id, {
      inputTokens: evalResponse.tokens.input,
      outputTokens: evalResponse.tokens.output,
      cacheReadInputTokens: evalResponse.tokens.cache_read_input ?? 0,
      cacheCreationInputTokens: evalResponse.tokens.cache_creation_input ?? 0,
    }),
  ]);
  if (logResult.status === "rejected") {
    logSafeError("logViolations failed", logResult.reason);
  }
  if (tokenResult.status === "rejected") {
    logSafeError("recordTokenUsage failed", tokenResult.reason);
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
    usage: {
      plan: auth.plan,
      used: newUsed,
      quota,
      remaining: Math.max(0, quota - newUsed),
      // checks_consumed reflects the proportional billing for this
      // single call. Callers (web app counter, MCP agents) use it to
      // explain "this paste cost you 2 checks" without re-implementing
      // the chars/check math client-side.
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

function warningThreshold(_plan: "free" | "pro" | "team", quota: number): number {
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
  plan: "free" | "pro" | "team";
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
