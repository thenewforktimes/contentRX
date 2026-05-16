/**
 * POST /api/check — the product's hot path.
 *
 * Flow:
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

import { createId } from "@paralleldrive/cuid2";
import { z } from "zod";
import { publicCheckEnvelope } from "@/lib/api-envelope";
import { revalidateDashboard } from "@/lib/revalidate";
import { resolveAuth } from "@/lib/auth";
import { safeAfter } from "@/lib/safe-after";
import {
  checkCostPause,
  evaluateAndPauseIfExceeded,
  recordUsageEvent,
} from "@/lib/cost-monitor";
import { corsJson, corsPreflight } from "@/lib/cors";
import { getDb } from "@/db";
import { appUrl, sendEmail } from "@/lib/email";
import { AUDIENCES, CONTENT_TYPES, MOMENTS } from "@/lib/engine-taxonomy";
import {
  evaluate,
  rewriteDocument,
  type EvaluateResponse,
} from "@/lib/evaluate";
import {
  computeCheckCacheKey,
  getCachedEvaluate,
  setCachedEvaluate,
  shouldCache,
} from "@/lib/check-cache";
import { hashText, logViolations } from "@/lib/log-violations";
import {
  MAX_INPUT_CHARS,
  isLargeInput,
  meter,
  meteringBlock,
} from "@/lib/metering";
import { fetchPrecedentsForCheck } from "@/lib/precedents";
import {
  detectSensitivePatterns,
  sensitiveDataErrorMessage,
} from "@/lib/pii-screen";
import { currentMonth, monthResetISO, monthlyQuota, type Plan } from "@/lib/quotas";
import { logSafeError } from "@/lib/safe-error-log";
import { checkRateLimit } from "@/lib/ratelimit";
import { SURFACE_SOURCES } from "@/lib/surfaces";
import {
  applyAddedRules,
  applyDisabledFilter,
  applyOverrides,
  containsDerivedBanToken,
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
// Length-routed metering (schema 3.0.0). The /api/check route no longer
// accepts a `segment_type` parameter — the engine derives the size
// class from `text.length`:
//
//   - small (≤200 chars): 1 unit (the floor).
//   - large (>200 chars):  Math.ceil(chars / 200) units, proportional.
//
// The same boundary governs the dashboard's UX routing: small inputs
// render the per-finding inline-diff cards; large inputs render the
// rich doc-tier UX (sticky verdict, holistic rewrite, categorized
// findings, inline excerpts). The wall-of-red-strikethrough antipattern
// is no longer reachable from any input — long content always gets the
// rich rendering.
//
// Hard input ceiling is MAX_INPUT_CHARS = 50,000. Beyond that the
// caller splits into multiple calls (MCP evaluate_copy_batch and the
// GitHub Action handle this client-side).

// CORS allowlist (audit S5): see `lib/cors.ts`. The Figma plugin
// iframe sends `Origin: null`; the marketing site is same-origin to
// /api/*; we narrowed from `*` to figma + localhost-dev as defense-
// in-depth. Auth is the bearer header, never a cookie, so an origin
// that isn't on the list still can't forge an authenticated call.

export async function OPTIONS(req: Request) {
  return corsPreflight(req);
}

const RequestSchema = z.object({
  // Hard ceiling: MAX_INPUT_CHARS = 50,000 per call. Schema 3.0.0
  // bills proportionally — 1 unit per 200 characters, rounded up,
  // with a floor of 1 unit. A 50-char button label is 1 unit; a
  // 600-char paragraph is 3; a 4,000-char document is 20.
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
        `characters per call). ContentRX bills 1 unit per 200 ` +
        `characters, rounded up. For copy longer than ` +
        `${MAX_INPUT_CHARS.toLocaleString()} chars, split into ` +
        `multiple calls — MCP evaluate_copy_batch and the GitHub ` +
        `Action handle this client-side.`,
    }),
  // Schema 3.0.0 dropped the `segment_type` parameter. Size is now
  // derived from `text.length` server-side. A pre-3.0.0 caller that
  // still sends `segment_type` will have it ignored (zod's default
  // `.strict()` would reject it; we keep the schema permissive so
  // old callers don't 400 during the cutover).
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
  source: z.enum(SURFACE_SOURCES),
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

  // PARALLEL PREFLIGHT (Phase 2 audit fix, 2026-05-14).
  //
  // checkCostPause, checkRateLimit, loadTeamRules, and
  // fetchPrecedentsForCheck are all independent reads — none depends
  // on the others' results. Running them in parallel saves ~12-32 ms
  // off the wall clock on every check; at 20K calls/day that's hours
  // of cumulative function time per day.
  //
  // The mutating `claimQuotaSlots` call stays sequential AFTER the
  // gates so rate-limited or paused callers don't burn quota slots
  // they can't actually use.
  //
  // Wasted-work tradeoff: if cost-pause/rate-limit denies, team-rules
  // and precedents work was wasted. At expected gate-deny rates
  // (rare; rate-limit at 60/min/user, cost-pause is a runaway-script
  // guard), this is net positive — the savings on the happy path far
  // outweigh the wasted work on rare denials.
  //
  // Each parallel arm preserves its existing failure mode:
  //   - cost-pause: fail-closed (default paused) on error
  //   - rate-limit: throw on error (rare; Upstash outage)
  //   - team-rules: throw on error (DB outage)
  //   - precedents: fail-open (empty array) on error — non-essential
  const [isPaused, rl, teamRules, precedents] = await Promise.all([
    checkCostPause(auth.user.id).catch((err) => {
      logSafeError("checkCostPause failed; defaulting to paused", err);
      return true as const;
    }),
    checkRateLimit(auth.user.id),
    // teamScope(auth), NOT raw auth.teamOwnerUserId. A team OWNER's
    // teamOwnerUserId is null (they're the root of their own team), so
    // the raw form made loadTeamRules early-return EMPTY for every
    // owner — silently making owners' disable/override/custom rules
    // (and, post-seam, their rewrite calibration directives) inert in
    // the check pipeline. The rules page stores under
    // `teamOwnerUserId ?? user.id`; teamScope() is the canonical
    // resolver for exactly that pivot and is already used elsewhere in
    // this route (usage scope, audit log). This call site was the lone
    // inconsistency. Owner = team-of-1 is the primary user shape, so
    // this bug made custom rules effectively not work for most users.
    loadTeamRules(teamScope(auth)),
    fetchPrecedentsForCheck({
      moment: moment ?? null,
      contentType: content_type ?? null,
    }).catch((err): Awaited<ReturnType<typeof fetchPrecedentsForCheck>> => {
      logSafeError("precedent retrieval failed", err);
      return [];
    }),
  ]);

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

  const quota = monthlyQuota(auth.plan, auth.seats);

  // Length-routed quota claim (schema 3.0.0). 1 unit per 200 chars,
  // rounded up, floor 1. A 50-char button label is 1 unit; a 600-char
  // paragraph is 3; a 4,000-char document is 20. The atomic claim is
  // all-or-nothing — if the user has 1 unit left and this call costs
  // 20, we 402 without touching the engine. Burst concurrency is
  // still safe (the upsert + setWhere guard composes the same way
  // for n > 1).
  const meterDecision = meter(text);
  const checksNeeded = meterDecision.unitsConsumed;
  // Team plans pool a single monthly quota across all members. Scope
  // the claim/usage row at the team owner so a member's call decrements
  // the shared count, and the dashboard's per-member read sees the
  // pooled total. teamScope(auth) returns auth.teamOwnerUserId for
  // members; auth.user.id for owners and non-team users.
  const usageScopeUserId = teamScope(auth);
  const claim = await claimQuotaSlots(usageScopeUserId, checksNeeded, quota);
  if (!claim.granted) {
    // Only fire the "you've hit your limit" email when the user is
    // truly at or past the cap. A multi-unit claim (n > 1) that gets
    // denied because count + n > quota — but count < quota — is a
    // transient per-call denial, not exhaustion. Telling that user
    // "you've hit this month's ContentRX limit" is wrong: they still
    // have remaining capacity, just not enough for THIS request.
    // The 402 response already carries `checks_required` so the
    // caller surfaces the right framing inline; the email only fires
    // when the cap is genuinely closed.
    //
    // after() schedules the email send to run after the 402 response
    // ships, but before Fluid Compute can recycle the function
    // instance — without it, a fire-and-forget `void` can lose the
    // email when the runtime tears down between requests. The send
    // itself is idempotent via Redis dedupe, so a runtime kill
    // mid-after() at worst delays the alert until the next exhaust.
    if (claim.count >= quota) {
      safeAfter(async () => {
        await notifyQuotaExhausted({
          to: auth.user.email,
          plan: auth.plan,
          quota,
          userId: auth.user.id,
        });
      });
    }
    // A team MEMBER (teamOwnerUserId set) has no billing access — the
    // pooled limit is the owner's to raise. Sending them to /pricing
    // is a dead-end; give owner-contact guidance instead. Owners and
    // solo-on-Team (teamOwnerUserId null) keep the self-serve link.
    const isTeamMember = auth.teamOwnerUserId !== null;
    return json(
      {
        error: "quota_exhausted",
        quota,
        used: claim.count,
        checks_required: checksNeeded,
        plan: auth.plan,
        upgrade_url: isTeamMember
          ? undefined
          : `${appUrl()}/pricing?from=quota`,
        message: isTeamMember
          ? "Your team's shared monthly check limit is used up. Ask your team owner to add seats, or wait for the reset."
          : undefined,
        resets_at: monthResetISO(),
        // Phase 4: surface overage opt-in info on the 402 so customers
        // know they can flip the switch instead of waiting for reset.
        // overage_available is false on Free (Free can't opt in) and on
        // paid plans during a BETA_OVERAGE=false window.
        overage_available: claim.overageAvailable ?? false,
        overage_rate_cents: claim.overageRateCents,
        opt_in_url: claim.optInUrl
          ? `${appUrl()}${claim.optInUrl}`
          : undefined,
      },
      { status: 402 },
    );
  }
  const newUsed = claim.count;
  const remainingAfter = Math.max(0, quota - newUsed);
  // Threshold-warning emails fire only on the in-quota path; once a
  // user crosses into overage they're past the cap and the
  // "approaching limit" framing no longer applies. The 100% email
  // already fired the first time the cap closed (claim went denied
  // before the opt-in flipped on).
  if (
    !claim.viaOverage &&
    remainingAfter <= warningThreshold(auth.plan, quota) &&
    remainingAfter > 0
  ) {
    safeAfter(async () => {
      await notifyQuotaWarning({
        to: auth.user.email,
        used: newUsed,
        quota,
        plan: auth.plan,
        userId: auth.user.id,
      });
    });
  }

  // teamRules + precedents were resolved up in the parallel preflight
  // block (Phase 2 audit fix). They land here as already-awaited values.
  // Block 2c rationale (precedent injection for voice guidance) and
  // its empty-array fallback semantics are unchanged.

  let evalResponse: EvaluateResponse;
  // Holistic rewrite, fired for large inputs (>UNIT_WINDOW chars) when
  // there are findings worth editing around. Null on small inputs,
  // null on clean docs, null on rewrite-call failure (best-effort,
  // non-fatal).
  let suggestedRewrite: string | null = null;
  // One-sentence diagnostic that rides alongside suggestedRewrite —
  // same lifecycle, same null conditions. Powers the verdict header.
  let suggestedDiagnostic: string | null = null;

  // LLM RESULT CACHE (Phase 2 audit fix, 2026-05-14).
  //
  // Repeat checks of identical input ("Save", "Cancel", common error
  // strings, CI re-runs of unchanged files) are a meaningful share of
  // /api/check traffic. Anthropic prompt caching shaves the input-token
  // cost; this layer skips the engine call entirely for repeats.
  //
  // The route still applies team rules, overrides, logs violations,
  // and increments usage on a cache hit — quota still ticks. The cache
  // only short-circuits the Anthropic call (and the rewrite for that
  // matter, since the rewrite is part of the cached EvaluateResponse
  // shape... actually no — rewrite is a separate call. See below.)
  //
  // Caching is skipped when precedents are present (team-specific
  // seed → cross-team contamination if cached).
  const cacheable = shouldCache(precedents.length);
  const cacheKey = cacheable
    ? computeCheckCacheKey({ text, audience, moment, content_type })
    : null;
  const cachedEval = cacheKey ? await getCachedEvaluate(cacheKey) : null;
  const cacheHit = cachedEval !== null;

  // Schema 3.0.0: the holistic rewrite fires for any "large" input
  // (>200 chars). Fired IN PARALLEL with the regular evaluate so wall
  // time is one round-trip, not two. The rewrite is best-effort.
  //
  // On a cache hit, we skip BOTH the evaluate call AND the rewrite
  // call — the rewrite is also expensive (full-document LLM call) and
  // deterministic-enough on the same input to reuse the cached
  // suggestedRewrite/suggestedDiagnostic stored alongside the cached
  // engine response.
  //
  // Cache shape note: the rewrite output is NOT cached separately here
  // — it gets folded into the same EvaluateResponse via the merge at
  // the bottom of this block, so caching the merged response carries
  // both. The rewrite path stays out of the cache for now (separate
  // dimension; team-specific suggestion candidates already gate
  // shouldCache).
  //
  // Project B length-independence (2026-05-15). The rewrite normally
  // fires only for "large" inputs (>200 chars). A hard ban is
  // length-independent — "a ban is a ban, no ifs ands or buts": if a
  // team bans em dashes and ships one in a 12-char button, the rewrite
  // must fire regardless of length. This trigger is strictly ADDITIVE
  // (a disjunct) — the global length threshold and its cost profile
  // are untouched; only inputs that actually contain a classifier-
  // derived ban token are pulled in early, and only when a hard_ban
  // rule exists for this team. Stylistic directives keep the plain
  // length gate (no deterministic token to force-detect). The pt.3
  // TIER-1 guarantee is what makes the fired rewrite actually remove
  // the token; until that lands the early-fired rewrite is the
  // existing best-effort seam (monotonic improvement, honest).
  const wantsRewrite =
    isLargeInput(text) || containsDerivedBanToken(text, teamRules.adds);

  // Calibration seam (2026-05-15). The team's customer-authored rule
  // prose — the human `rule` text on `add` rules and the reworded
  // text on `override` rules — is the team's voice intent. It feeds
  // the rewrite's TIER 2 customer block so the suggested rewrite is
  // calibrated to the team instead of silently imposing the default
  // (the gap that blocked onboarding: disabling a flag hid the
  // symptom but the rewrite still fought the customer). The regex
  // `pattern` keeps doing its additive-flag job unchanged; the prose
  // is the part that shapes the rewrite. TIER 1 (the brand quality
  // floor) is non-overridable regardless of what these say — enforced
  // structurally in rewrite_document._build_system_prompt, gated by
  // tests/test_rewrite_document_prompt.py. Scope note: disabled-
  // standard-aware rewriting is a documented fast-follow, not P0.
  const styleDirectives: string[] = [
    ...teamRules.adds.map((a) => a.fields.rule),
    ...Array.from(teamRules.overridesByStandardId.values(), (o) => o.rule),
  ]
    .filter((r): r is string => typeof r === "string" && r.trim().length > 0)
    .map((r) => r.trim());

  let rewriteSettled: PromiseSettledResult<Awaited<
    ReturnType<typeof rewriteDocument>
  > | null> = { status: "fulfilled", value: null };

  if (cacheHit && cachedEval) {
    evalResponse = cachedEval;
  } else {
    const evaluatePromise = evaluate({
      text,
      content_type,
      audience,
      moment,
      precedents: precedents.map((p) => ({
        approved_text: p.approvedText,
        sample_size: p.sampleSize,
      })),
    });
    const rewritePromise: Promise<
      Awaited<ReturnType<typeof rewriteDocument>> | null
    > = wantsRewrite
      ? rewriteDocument(text, styleDirectives).catch((err) => {
          logSafeError("rewriteDocument() failed; returning null", err);
          return null;
        })
      : Promise.resolve(null);

    const [evalSettled, rs] = await Promise.allSettled([
      evaluatePromise,
      rewritePromise,
    ]);
    rewriteSettled = rs;

    if (evalSettled.status === "rejected") {
      logSafeError("evaluate() failed", evalSettled.reason);
      return json(
        { error: "Evaluation service unavailable" },
        { status: 502 },
      );
    }
    evalResponse = evalSettled.value;
  }
  if (rewriteSettled.status === "fulfilled" && rewriteSettled.value) {
    const rewriteResp = rewriteSettled.value;
    evalResponse = {
      ...evalResponse,
      latency_ms:
        evalResponse.latency_ms + rewriteResp.latency_ms,
      tokens: {
        input: evalResponse.tokens.input + rewriteResp.tokens.input,
        output: evalResponse.tokens.output + rewriteResp.tokens.output,
        cache_creation_input:
          (evalResponse.tokens.cache_creation_input ?? 0) +
          (rewriteResp.tokens.cache_creation_input ?? 0),
        cache_read_input:
          (evalResponse.tokens.cache_read_input ?? 0) +
          (rewriteResp.tokens.cache_read_input ?? 0),
      },
    };
    suggestedRewrite = rewriteResp.result.rewritten;
    suggestedDiagnostic = rewriteResp.result.diagnostic
      ? rewriteResp.result.diagnostic
      : null;
  }

  // Cache write — only on a cache MISS (cacheHit === false) and only
  // when the request is cacheable (no team-specific precedents).
  // Fire-and-forget via safeAfter so the Redis SET round-trip doesn't
  // add latency to the response. The set itself is wrapped in
  // try/catch (see check-cache.ts) so a Redis outage never leaks
  // out.
  if (cacheable && !cacheHit && cacheKey) {
    const responseToCache = evalResponse;
    safeAfter(async () => {
      await setCachedEvaluate(cacheKey, responseToCache);
    });
  }

  // Team-rule pipeline: disable first (strip), then override display fields
  // on the survivors, then append custom team-added rule matches, then
  // recompute verdict from the final violations list.
  const disabled = applyDisabledFilter(evalResponse.result, teamRules.disabledStandardIds);
  const overridden = applyOverrides(disabled, teamRules.overridesByStandardId);
  const withAdds = applyAddedRules(overridden, text, teamRules.adds);
  const result = recomputeVerdict(withAdds);

  // Hoisted from the response-shaping block below: the doc-tier outputs
  // are suppressed for clean documents (the LLM was instructed to return
  // the input largely unchanged when nothing's wrong, so surfacing a
  // near-identical "rewrite" is noise). Computed once here so both the
  // recordUsageEvent write and the response envelope reach for the same
  // values — persisting then re-suppressing in the response would write
  // rewrites we won't ever surface back to the customer.
  const isCleanDoc = result.verdict === "pass";
  const finalSuggestedRewrite =
    suggestedRewrite !== null && !isCleanDoc ? suggestedRewrite : null;
  const finalSuggestedDiagnostic =
    suggestedDiagnostic !== null && !isCleanDoc ? suggestedDiagnostic : null;

  // Observational writes — three rows across two tables. The pair of
  // (violations row(s), usage_events row) form the audit trail for
  // this single /api/check call; the run audit page LEFT JOINs them
  // on `violations.check_event_id ↔ usage_events.id`. They must commit
  // together or roll back together. A partial commit (process crash,
  // transient DB error between them) leaves data inconsistent: e.g.,
  // usage_events row exists (cost-monitor sees a charge) without
  // matching violations rows (dashboard shows no findings). At 600K
  // events/month even a 0.1% partial-failure rate would produce 600
  // inconsistent rows. Phase 2 audit fix (2026-05-14): wrap the two
  // writes in `db.transaction` so they atomically commit. The token-
  // usage upsert is a separate row in `usage` (per-user-per-month
  // counter) and stays outside the transaction — it's idempotent on
  // the same (userId, month) row, so a partial failure can't cause
  // double-counting.
  const teamIdForLog = teamScope(auth);
  const tokens = {
    inputTokens: evalResponse.tokens.input,
    outputTokens: evalResponse.tokens.output,
    cacheReadInputTokens: evalResponse.tokens.cache_read_input ?? 0,
    cacheCreationInputTokens: evalResponse.tokens.cache_creation_input ?? 0,
  };
  // One cuid threaded through both writes so violations.check_event_id
  // === usage_events.id for this call. The run audit page leftJoin's
  // on that key to pull text_preview alongside each finding. Without
  // this — what the schema previously did — the two tables generated
  // independent cuids and the join always returned NULL.
  const checkEventId = createId();
  const db = getDb();
  const [auditResult, tokenResult] = await Promise.allSettled([
    db.transaction(async (tx) => {
      await Promise.all([
        logViolations(
          {
            userId: auth.user.id,
            teamId: teamIdForLog,
            source,
            contentType: result.content_type ?? content_type ?? "unknown",
            moment: (result.moment as string | undefined) ?? moment ?? null,
            text,
            violations: result.violations,
            filePath: file_path ?? null,
            reviewReasonSubtype:
              (result as { review_reason?: string | null }).review_reason ??
              null,
            runId: run_id ?? null,
            checkEventId,
          },
          tx,
        ),
        // Phase 4 cost-monitor + check-history: one event row per /api/check
        // completion. The cost columns drive /admin/costs + the threshold-
        // evaluation pause logic. The check-history columns drive
        // /dashboard/checks — the customer-facing list of "what did I run?".
        // text_preview stores the first 80 chars of the input so customers
        // can recognise their own checks. Customer-not-product (ADR
        // 2026-04-28): the customer's own data, shown back to the customer,
        // is not aggregation. A future TTL will null text_preview after 90
        // days.
        recordUsageEvent(
          {
            id: checkEventId,
            userId: auth.user.id,
            segmentType: meterDecision.sizeClass,
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
              (result as { review_reason?: string | null }).review_reason ??
              null,
            violationCount: result.violations.length,
            textHash: hashText(text),
            textPreview: text.slice(0, 80),
            // 2026-05-10 detail-page round 3 — store the full input + doc-tier
            // outputs so /dashboard/checks/[id] can render exactly what the
            // customer saw at check time, and so the Re-run CTA can re-issue
            // the same call without depending on the user having the source
            // text on hand.
            textFull: text,
            suggestedRewrite: finalSuggestedRewrite,
            suggestedDiagnostic: finalSuggestedDiagnostic,
          },
          tx,
        ),
      ]);
    }),
    recordTokenUsage(usageScopeUserId, tokens),
  ]);
  if (auditResult.status === "rejected") {
    // Transaction failure — either logViolations or recordUsageEvent
    // (or both) failed; the DB rolled back, neither row landed. Phase
    // 2 audit fix: the partial-failure window the older 3-arm
    // Promise.allSettled exposed is closed by atomic commit-or-roll-
    // back. Log and continue — the user already got their result and
    // quota was claimed.
    logSafeError(
      "check audit-trail transaction failed (violations + usage_event)",
      auditResult.reason,
    );
  } else {
    // Threshold evaluation runs only when the audit trail committed
    // (otherwise the cost row for this call doesn't exist yet and the
    // rollup would understate spend). Errors here are non-fatal —
    // the next call's evaluation will catch the same threshold cross.
    // Wrapped in safeAfter so Fluid Compute holds the function
    // instance open long enough for the rollup query + email to
    // finish; without it, a runtime tear-down between requests
    // would silently drop the alert.
    safeAfter(async () => {
      try {
        const result = await evaluateAndPauseIfExceeded(auth.user.id);
        if (result?.pausedNow) {
          await notifyCostPause({
            userEmail: auth.user.email,
            userId: auth.user.id,
            ...result,
          });
        }
      } catch (err) {
        logSafeError("evaluateAndPauseIfExceeded failed", err);
      }
    });
  }
  if (tokenResult.status === "rejected") {
    logSafeError("recordTokenUsage failed", tokenResult.reason);
  }

  // Bust the dashboard's edge cache + tag-cached loaders so the usage
  // counter, "This week" panel, and Active-Surfaces row reflect this
  // check on the next render. Scope: this user's usage, this team's
  // violations. See `lib/revalidate.ts` + `lib/cache-tags.ts`.
  revalidateDashboard({ userId: usageScopeUserId, teamId: teamIdForLog });

  // Public envelope (schema 2.0.0). `result` is the substrate
  // CheckResult shape returned by the Python engine; we project it
  // down to the four-field public Violation envelope and drop
  // substrate top-level fields (`passes`, `pipeline`, `moment`,
  // `audience`, `content_type`, `summary`, `overall_verdict`,
  // `rationale_chain`). The PUBLIC_TAXONOMY env var (default false)
  // controls whether substrate Violation fields surface inline for
  // reversibility — see `decisions/2026-04-25-private-taxonomy-pivot.md`.
  // API-usage telemetry (`latency_ms`, `tokens`, `usage`) is request
  // metadata, not taxonomy, and lives alongside the envelope. The
  // `finalSuggested*` values were computed above with the persistence
  // writes so the DB row and the response carry the same suppression
  // decision.

  return json({
    ...publicCheckEnvelope(result, {
      suggestedRewrite: finalSuggestedRewrite,
      suggestedDiagnostic: finalSuggestedDiagnostic,
    }),
    // 2026-05-10 detail-page round 3 — surface the usage_events row id
    // so the dashboard's "Run check" / "Re-run" CTAs can deep-link to
    // /dashboard/checks/[id] after a fresh call. Lives alongside the
    // envelope (request metadata, not taxonomy) so it doesn't bump
    // schema_version; existing consumers ignore unknown sibling fields.
    check_id: checkEventId,
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
      // checks_consumed reflects the units charged for this single
      // call. Mirrors `metering.units_consumed`. Callers (web app
      // counter, MCP agents) read either to explain "this paste cost
      // 5 units" without re-implementing the metering math client-
      // side.
      checks_consumed: checksNeeded,
      month: currentMonth(),
      text_hash: hashText(text),
    },
  });
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
        appUrl: appUrl(),
        used: args.used,
        quota: args.quota,
        plan: args.plan,
      }),
      dedupeKey: `warning:${args.userId}:${currentMonth()}`,
    });
  } catch (err) {
    // Audit M7 (2026-05-13): use logSafeError, not console.warn.
    // Resend SDK errors can carry the rendered email subject (which
    // includes the user's quota count) on `.message`/`.cause` —
    // logSafeError truncates and drops transitive props.
    logSafeError("quota-warning email failed", err);
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
        appUrl: appUrl(),
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
    // Audit M7 (2026-05-13): see quota-warning equivalent above.
    logSafeError("quota-exhausted email failed", err);
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
        appUrl: appUrl(),
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
