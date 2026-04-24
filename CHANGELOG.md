# Changelog

ContentRX ships as a Python engine plus six user-facing surfaces in one
repo. Each surface has its own version. This file tracks user-visible
changes per surface, in reverse chronological order.

---

## Engine — `src/content_checker/`

Source of truth: `src/content_checker/__init__.py` (`__version__`).

### Unreleased — 2026-04-23 (human-eval build plan Sessions 1–14)

Session 14 — ethical framework + /ethics page:

- New `/ethics` public page — the five commitments that govern how
  ContentRX collects, attributes, and uses external signal
  (transparency, attribution, respect, license-awareness, PII
  avoidance). Ships before Session 15's GitHub mining pipeline so
  the opt-out path exists before any scraping.
- New `/sources` stub — linked from `/ethics`'s transparency section.
  Populated by Session 19 with per-source crawl timestamps + roles.
  Stub points at the committed per-standard `sources` metadata in
  `standards_library.json` as the interim accountability surface.
- Opt-out path: `hello@contentrx.io` with `[OPTOUT] <source name>`
  subject convention. Commitment: confirm within a week, stop fresh
  crawls in the next cycle, best-effort remove derived signal in
  the release after.

**Copy note:** the voice is plain + first-person — Robo should edit
these pages into his own voice before launch. The commitments
themselves are locked to the plan spec; the prose around them is
editable.

Deferred per dependencies:
  - `/sources` population — Session 19 (needs Session 15 crawler +
    Session 16 consolidated attribution metadata)
  - Attribution linting check (catches close-paraphrase without
    attribution) — Session 35

### Unreleased — 2026-04-23 (human-eval build plan Sessions 1–13)

Session 13 — scan/validate disagreement as ensemble signal:

- Fixes a Session 2 routing error: `scan_validate_disagreement` was
  flipping verdicts to `standards_conflict`. Those are two different
  signals. Session 13 splits them into `ensemble_disagreement` (the
  first-pass ensemble — scan vs validate LLM calls — disagreeing with
  itself) and `standards_conflict` (multi-standard taxonomic
  conflict, reserved for a future pipeline hook).
- New `REVIEW_ENSEMBLE_DISAGREEMENT` review_reason subtype. Slots in
  precedence between standards_conflict and situation_ambiguity.
- `Violation.validate_rejection_reason` — when scan proposed a
  violation and validate rejected it, validate's reason carries
  through so the review queue surfaces both sides.
- `derive_verdict` now flips the verdict to review_recommended even
  when `violations` is empty if scan/validate disagreed — "every
  validate-rejection produces a review_recommended event" per spec.
- `pipeline.py` HOP_VALIDATE rationale hop preserves rejected_details
  (standard_id + scan_issue + scan_suggestion + validate reason) so
  the full disagreement survives to any review surface without
  re-running the pipeline.
- `tools/graduation_metrics.py` adds
  `compute_ensemble_disagreement_rate` — per-standard tracked signal
  (not a hard gate). When pipeline events are supplied via the new
  `--pipeline-events` flag, the readiness report carries
  `ensemble_disagreement: {scan_proposals, validate_rejections,
  disagreement_rate}` per standard.
- API schema bumped 1.5.0 → 1.6.0 (additive).

### Unreleased — 2026-04-23 (human-eval build plan Sessions 1–12)

Session 12 — rollback + auto-demotion:

- New `/api/cron/rollback-monitor` — nightly auto-demotion monitor.
  For every graduated standard, computes the rolling 14-day
  actor-weighted override rate against the violations denominator
  and auto-demotes one step when it meets/exceeds the level's
  threshold (5% autonomous → batch_approval, 10% batch → robo_labels).
  Min-denominator floor of 10 violations suppresses noise on
  low-traffic standards. Auth via `CRON_SECRET` (shared with the
  weekly digest). Writes to `graduation_status.history` with
  `source: "auto_demotion"` so the audit trail captures the rate
  + reason.
- New `/api/graduation/demote` — manual demotion. Admin-gated via
  the same `CONTENTRX_ADMIN_CLERK_IDS` allow-list as approve.
  Validates target is a strict step down.
- New `demote-button.tsx` client island wired into the level
  breakdown on `/dashboard/graduation`. Each graduated standard
  shows a compact demote button next to its row.
- `src/lib/graduation.ts` extended with `AUTO_DEMOTION_THRESHOLD`
  (mirrors Session 10 cutoffs), `AUTO_DEMOTION_WINDOW_DAYS` (14),
  `AUTO_DEMOTION_MIN_VIOLATIONS` (10), `demoteOneStep`,
  `shouldAutoDemote`, `weightedOverrideCount`, `ACTOR_ROLE_WEIGHT`.
- 18 new vitest tests: demoteOneStep (all 3 levels), threshold table
  integrity, shouldAutoDemote (fires / doesn't fire at boundary,
  suppressed by min-denominator, never on robo_labels), weighted
  count math.

Deferred per scope:
  - Suspend (pull standard out of engine evaluation entirely) —
    requires engine integration; soft-suspend via demote-to-robo
    is available today
  - Email notifications on auto-demotion — reuse the Resend pipeline
    in a follow-up; for now the audit trail in `graduation_status.history`
    captures it
  - Vercel Cron activation — same `CRON_SECRET` + `vercel.json`
    snippet as the weekly digest

### Unreleased — 2026-04-23 (human-eval build plan Sessions 1–11)

Session 11 — graduation UI + approval workflow:

- New `/dashboard/graduation` — server-rendered list of eligible
  promotions (filtered from `evals/graduation/readiness.json`) plus a
  read-only breakdown of every standard grouped by current level.
  Shows key criteria pills (sample, κ, raw agreement, override rate)
  and a "what changes" consequence line per target level.
- New `/api/graduation/approve` — POST-only, admin-gated. Validates
  the target is a strict promotion, appends an audit entry to
  `graduation_status.history`, updates `level`. Uses
  `recordLevelChange` (Session 10) so the history stays append-only.
- Client island `approve-button.tsx` — one-click approve; prompts for
  a reason that lands in the audit log. Hides when the user isn't
  on the admin allow-list.
- New `canApproveGraduation(clerkId)` helper — reads
  `CONTENTRX_ADMIN_CLERK_IDS` env var (comma-separated). Unset = no
  approvals possible (safe default in prod).
- New `LEVEL_CONSEQUENCES` copy per level — shown in the UI so the
  reviewer sees what changes (review queue behavior + rollback
  trigger) before clicking.
- 13 new vitest tests covering the helper + ladder ordering + consequence
  copy + allow-list parsing.

Deferred per dependencies:
  - Auto-demotion monitor (Session 12 — 2-week override-rate breach)
  - Manual demotion UI (same — Session 12)
  - First actual graduation — requires real reviews + real production
    overrides; today all 43 standards are at robo_labels and no
    promotions are eligible

### Unreleased — 2026-04-23 (human-eval build plan Sessions 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10)

Session 10 — graduation criteria + metric instrumentation:

- New `tools/graduation_metrics.py` implementing all six hard-gate
  criteria per standard: sample size (with tightening modifier +
  absolute floor), Cohen's κ (ratio against Session 7's measured
  ceiling, stable over a 4-week window), McHugh raw-agreement floor,
  MCC supplementation for low-prevalence standards, actor-weighted
  override rate, novel-counterpart tier + structural variation +
  ≥80% pass rate. All AND-ed — no averaging.
- Rule-version credit policy codified: semantic change → full reset,
  wording change → 50% weight, additive carve-out → outside-only
  carries at full weight.
- New `evals/graduation/readiness.json` — baseline computed across
  all 43 standards from the industry corpus. All at `robo_labels`
  today (zero reviews + zero production overrides).
- New `evals/graduation/README.md` — policy documentation, schema
  reference, run instructions.
- New `graduation_status` DB table (schema.ts) + `src/lib/graduation.ts`
  helper (`getGraduationStatus`, `writeReadinessSnapshot`,
  `recordLevelChange`). Level enum: `robo_labels` / `batch_approval`
  / `autonomous`. History is append-only JSONB. `npm run db:push` to
  apply.
- 43 new pytest tests covering κ / MCC / raw-agreement math, prevalence
  banding, counterpart tiers and variation axes, pass-rate edge
  cases, rule-version credit (semantic / wording / additive /
  unknown), stability-window bucketing, and end-to-end
  `assess_standard` composition (hard-gate behavior: high-κ-zero-
  counterparts still blocked, actor-weighted override rate,
  tightening kicks in at 150 agreements, thresholds scale with
  measured ceiling).

Deferred per dependencies:
  - Approval UI (Session 11 — one-click graduation based on these
    readiness rows)
  - Auto-demotion monitor (Session 12 — 2-week override-rate breach
    triggers automatic step-down)
  - Direct DB review-event ingestion (today reads a JSON dump)

### Unreleased — 2026-04-23 (human-eval build plan Sessions 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9)

Session 9 — review cadence dashboards + weekly digest:

- New `/dashboard/cadence` — daily 15-min landing. Top-of-queue
  (N most-recent overrides), urgent flags (override-rate spikes + new
  out-of-distribution clusters vs prior 7 days), pointers to this
  week's moment + monthly calibration.
- New `/dashboard/cadence/moment/[moment]` — weekly moment deep-
  review, filtered to one of the 13 moments. 30-day window. Shows
  override stream + top-overridden standards + refinement-log pointer.
- New `/dashboard/cadence/calibration` — monthly calibration. Reads
  the latest `evals/drift/reports/*.json` (from Session 7) and renders
  measured κ + 95% CI + threshold regime. Links the moment-rotation
  schedule.
- New `/api/cron/weekly-digest` — sends the weekly digest to all
  team-plan admins with a `(user, ISO-week)` Redis dedupe key. Auth
  via `CRON_SECRET` header — no env-var bypass. Wire into Vercel Cron
  when ready (sample `vercel.json` snippet in the route file).
- New `src/emails/weekly-digest.tsx` — React email template. Renders
  through the existing Resend pipeline + `_shell.tsx` layout.
- New `src/lib/cadence.ts` — pure helpers: `momentForWeek`
  (13-week rotation using ISO week), `detectUrgentFlags`
  (spike-multiplier + min-absolute-count), `aggregateVelocity`
  (recent-vs-prior-half trend), `buildWeeklyDigest`.
- 20 new vitest tests covering moment rotation (all 13 surface in 13
  weeks, determinism), ISO week math (including the year-rollback
  edge case), urgent-flag detection (new-standard path, spike path,
  minimum-count floor, custom multipliers), velocity aggregation,
  weekly-digest delta math.

Deferred per-scope:
  - MCP surfacing of the cadence data — deliberately scoped out; can
    land as a follow-up if the Claude-Code surface becomes priority.
  - Vercel Cron activation — workflow is in place; user flips on
    `vercel.json` + `CRON_SECRET` when ready.
  - Pending-refinement count in the digest — needs a log parser
    (Session 34 territory); today hard-coded to 0.

### Unreleased — 2026-04-23 (human-eval build plan Sessions 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8)

Session 8 — production override review queue:

- New `tools/review_queue.py` — turns a stream of production override
  events into an ordered, batched queue for Robo's 50-items-in-60-
  minutes review cadence. Stage-aware: phase auto-detects from the
  annotated corpus (`<500` high-confidence tuples → early/exploration,
  `≥500` → late/exploitation). Outer dimension is audience
  (provisional). Subtypes cascade: novel combinations, standards_conflict,
  ensemble_disagreement, standard_pushback aggregates (Session 4),
  calibration sample (5% early → 10% late).
- New `tools/batch_summary.py` — after a batch is reviewed, tallies
  actions (agree/override/skip), detects `recurring_standard_override`
  patterns (3+ overrides on the same standard inside one batch), and
  can draft a candidate entry in `taxonomy_refinement_log.md` under
  "Open refinements" with the existing format.
- New `tools/audience_retest.py` — the 50-general-audience trigger.
  Computes `P(general | FP)`; emits `keep_audience_first` /
  `drop_audience_first` / `pending` / `inconclusive` so the queue
  builder can flip its outer dimension when the data is in.
- New `evals/review_queue/README.md` — workflow, queue-order table per
  phase, schemas for queue output + completed batch + pattern/draft,
  deferred items (web surface, direct DB integration).
- 41 new pytest tests covering phase detection, novel-combination
  marking, stage-aware ordering (early vs late; audience-first on/off),
  batching (size-3 clusters, audience-boundary splits), deterministic
  calibration sampling (5% vs 10%; high-confidence-only), batch
  summary pattern detection, refinement-log append under
  "Open refinements" (preserving order), and audience-retest decision
  logic across the four outcome branches.

### Unreleased — 2026-04-23 (human-eval build plan Sessions 1 + 2 + 3 + 4 + 5 + 6 + 7)

Session 7 — quarterly self-drift check:

- New `tools/drift_check.py` with three subcommands: `build-panel`
  (80-case stratified sample from the eligible pool, deterministic),
  `export-blind` (strips past verdicts + rationale for unbiased
  re-labeling), `score` (computes κ + 95% CI + per-standard
  disagreement + threshold regime from re-labeled responses).
- New `evals/drift/panels/2026-q2.json` — first quarterly panel, 80
  cases stratified across 10 moments and 8 content-types.
- New `evals/drift/README.md` — stratification, cadence, regime table,
  schemas for panel / blind / responses / report.
- Threshold-recalibration formula codified: `autonomous κ = 0.94 ×
  ceiling`, `batch-approval κ = 0.83 × ceiling`. Regimes:
  `target_met` (≥0.90), `maturing` (0.85–0.90), `graduation_frozen`
  (0.80–0.85), `degraded` (<0.80). Session 10's graduation metrics
  will read these values off the drift report.
- 35 new pytest tests for regime classification, threshold
  calibration, κ + 95% CI, stratified panel construction
  (determinism, growth stability, budget respect), blind panel
  export, and drift-report scoring.
- Coverage gap documented in README: 4 moments (destructive_action,
  confirmation, empty_state, interruption) have zero eligible cases
  today — drift measurement for those is impossible until annotation
  lands. The panel skips them; the regime classification accounts
  for the gap.

### Unreleased — 2026-04-23 (human-eval build plan Sessions 1 + 2 + 3 + 4 + 5 + 6)

Session 6 — held-out eval as a second CI gate:

- New `.github/workflows/held_out.yml` — two jobs. `convention`
  enforces the `held-out-update:` commit-message prefix on any
  commit that edits held-out data (fast, free, no corpus needed).
  `held-out` fetches the private corpus via
  `HELD_OUT_CORPUS_TARBALL_URL`, runs `tools/run_held_out.py`, and
  fails on any disagreement. The gate is wired but **not enabled**
  until the corpus secret + `ANTHROPIC_API_KEY` are configured —
  workflow exits cleanly with a notice until then (no silent pass).
- New `scripts/check_held_out_convention.py` — walks commits in the
  PR range, requires `held-out-update:` prefix on any commit that
  touches `evals/held_out/manifest.json` or `evals/industry/`.
  Usable locally via `python3 scripts/check_held_out_convention.py`.
- New `docs/HELD_OUT_GATE.md` — approval ceremony, local-run
  instructions, corpus-in-CI setup steps, cost note.
- 20 new tests for the convention checker (path matching, prefix
  regex, end-to-end runs against a throwaway git repo).

### Unreleased — 2026-04-23 (human-eval build plan Sessions 1 + 2 + 3 + 4 + 5)

Session 5 — held-out golden set carve-out:

- New `evals/held_out/manifest.json` — 100-case reference list carved
  from the annotated industry corpus. Stable, deterministic order. No
  raw text duplicated — manifest stores `case_id` + selection
  metadata; text stays in the (gitignored) source files.
- New `evals/held_out/README.md` — selection criteria, retirement
  rules, coverage-gap disclosure.
- New `tools/select_held_out.py` — selection tool. Pass 1 covers every
  moment with ≥5 eligible cases (≥5 slots each). Pass 2 covers every
  standard with ≥3 eligible cases (≥3 slots each). Pass 3 fills to
  target via source-proportional largest-remainder allocation. Pass 4
  fills residual gaps in deterministic order. All passes respect the
  budget so no destructive trim is ever needed.
- New `tools/run_held_out.py` — runner that looks each manifest entry
  up in `evals/industry/`, invokes the pipeline, and computes
  Cohen's κ + agreement rate + per-case disagreement report. Exits
  non-zero on any disagreement (Session 6 CI gate consumes this).
  Exits 3 when the private corpus isn't available — "silent pass" is
  not a supported state.
- `case_id` synthesis: about one-third of eligible cases ship with
  null `case_id`. The loader synthesizes `auto:<source_file>:<index>`
  so they can be referenced. Corpus should grow real IDs over time.

### Unreleased — 2026-04-23 (human-eval build plan Sessions 1 + 2 + 3 + 4)

Session 4 — structured override reasons + session aggregation:

- `violation_overrides` gains two columns: `override_reason_code`
  (5-item enum) and `session_id` (free-form text). Both nullable;
  `npm run db:push` to apply.
- `POST /api/violations/override` accepts both new fields.
- New helper `src/lib/override-reasons.ts` codifies the five codes
  (`not_applicable_here`, `standard_too_strict`, `fix_is_worse`,
  `shipping_anyway`, `confusing_need_more_context`) plus each code's
  *typical* (not mechanical) mapping to Robo's `triage_category`
  vocabulary.
- New helper `src/lib/session-aggregation.ts` collapses three or more
  same-standard overrides from a single session into a
  `standard_pushback` review-queue entry. Rows without a `session_id`
  fall back to a `(user_id, 10-minute-window)` pseudo-session.
- Figma plugin: after Disagree or Ship-anyway the card reveals a
  reason `<select>`; submission waits for a selection. Agree still
  submits immediately. Each scan now generates a `currentSessionId`
  and sends it on every override.
- Dashboard `/dashboard/overrides` adds a "Standard pushbacks" panel
  above the most-overridden list.

### Unreleased — 2026-04-23 (human-eval build plan Sessions 1 + 2 + 3)

Session 3 — in-product signal instrumentation:

- `violation_overrides` table gains five columns: `override_stance`,
  `actor_role`, `rationale_expanded`, `time_to_action_ms`,
  `suggested_text_hash`, `applied_text_hash`. `npm run db:push` to
  apply. All nullable — existing rows keep working.
- `POST /api/violations/override` accepts the richer signal. Hashes
  `suggested_text` and `applied_text` server-side (same sha256 contract
  as `text`).
- Figma plugin: single "Dismiss" button replaced with the three-button
  stance row (Agree / Disagree / Ship anyway) plus collapsed-by-default
  rationale. Each stance click POSTs `override_stance`, `actor_role`,
  `rationale_expanded`, and `time_to_action_ms` alongside the existing
  fields.
- Dashboard `/dashboard/overrides` adds a "Behavior quadrants" panel —
  informed rejects, informed accepts, pattern-match accepts, reflex
  rejects, and pre-Session-3 rows as "unclassified."
- New helpers: `src/lib/actor-role.ts` (source → default role) and
  `src/lib/behavior-quadrant.ts` (signals → quadrant). Pure functions
  with full vitest coverage.

### Unreleased — 2026-04-23 (human-eval build plan Sessions 1 + 2)

Session 1:

- Per-standard versioning on `standards_library.json`: every standard
  now carries a `version` and `version_history`, so eval records can
  pin against a specific rule revision. The library-level top-level
  `version` remains the engine's package version.
- `Violation` gains `related_standards`, `ambiguity_flag`, and
  `rule_version` fields. `rule_version` is stamped from the loaded
  standards library at evaluation time.
- `CheckResult` gains `rationale_chain` — an ordered list of
  `RationaleHop` entries, one per pipeline stage (classify,
  detect_moment, filter, preprocess, scan, validate, merge). Each hop
  captures inputs, output, confidence (when applicable),
  `rule_versions` consulted, and an optional typed `ambiguity_flag`.

Session 2:

- `CheckResult.review_reason` gains four new typed subtypes beyond
  the existing `low_confidence`: `standards_conflict`,
  `situation_ambiguity`, `out_of_distribution`, `novel_pattern`.
  Every `review_recommended` verdict now carries a specific typed
  reason — no generic fallback. Precedence: standards_conflict >
  situation_ambiguity > out_of_distribution > novel_pattern >
  low_confidence.
- `derive_verdict` now accepts optional signal kwargs
  (`scan_validate_disagreement`, `moment_ambiguous`,
  `out_of_distribution`, `novel_pattern`); the pipeline passes the
  first two today.
- New `moments.detect_moment_with_confidence` returns `(moment, confidence)`.
  Below `MOMENT_CONFIDENCE_THRESHOLD` (0.6), the pipeline flips the
  verdict to `review_recommended` with `situation_ambiguity`.
  `detect_moment` is now a thin wrapper that drops the confidence.

- API schema_version bumped 1.1.0 → 1.3.0 (two minor bumps, both
  additive).

### 4.6.1 — 2026-04-22

- Added per-violation `confidence` field (0–1) on LLM-flagged
  violations. Low-confidence violations (< 0.7) promote to the
  `review_recommended` verdict instead of `violation`.
- Prompt now includes calibration anchors so the confidence score is
  well-distributed instead of collapsing to 0.95 for everything.

### 4.6.0 — 2026-04-22 (v2 Session 10)

- New verdict state: `REVIEW_RECOMMENDED`. First-class alongside
  `VIOLATION` and `PASS`. Surfaces it through every API, client, and
  output format.
- `Verdict` enum + `confidence: float` + `review_reason:
  Optional[ReviewReason]` fields on every violation.
- Confidence policy: LLM confidence < 0.7 OR moment-classifier
  confidence < 0.6 → REVIEW; otherwise VIOLATION or PASS as before.
- Bumped API schema_version to 1.1.0 (minor, additive).

### 4.5.1 — 2026-04-22 (v2 Session 3)

- `src/content_checker/api_utils.py` — single source for LLM JSON
  parsing (`parse_llm_json`). Replaces three divergent parse sites.
- All Anthropic clients now pass `max_retries=2`.
- `load_standards()` reads disk once per process; subsequent calls hit
  a module-level cache.

### 4.5.0 — 2026-04-22 (v2 Session 2)

- JS/Python preprocessor parity gate in CI
  (`.github/workflows/parity.yml`). 53 cases, 53/53 agreement. Any
  divergence fails the PR.

---

## Web app — `src/app/` + `src/app/api/`

The API surface is versioned via the `schema_version` field in every
response envelope. Following semver; minor = additive, major =
breaking. See `docs/API_VERSIONING.md`.

### schema 1.1.0 — 2026-04-22 (PR #29)

- Added: `verdict`, `confidence`, `review_reason` on every violation
  (additive).
- Added: override-capture endpoints — `POST /api/violations/override`,
  `GET /api/team-analytics/overrides`.
- Added: `/dashboard/overrides` analytics page.

### schema 1.0.0 — 2026-04-22 (PR #28)

- Introduced the schema-versioning envelope: every API response carries
  `schema_version` (semver) and an optional `warnings` array. Existing
  clients keep working via additive envelope siblings.
- `docs/API_VERSIONING.md` documents the policy.

### Infrastructure

- **2026-04-23 (PR #38):** Row-level security enabled on all eight
  public tables (defense-in-depth). FK indexes added on
  `ditto_syncs.user_id`, `team_members.member_user_id`,
  `violation_overrides.violation_id`.
- **2026-04-22 (PR #30):** `violation_overrides` table added (Session 11).

---

## MCP server — `contentrx-mcp` on PyPI

### 0.4.0 — 2026-04-23

- **Default API URL changed** from `https://content-rx.vercel.app` to
  `https://contentrx.io`. Existing 0.3.0 installs keep working —
  Vercel keeps `content-rx.vercel.app` alive as the project's default
  subdomain indefinitely. Upgrade when convenient; not urgent.
- Dashboard URL in `AuthError` / `AuthFailedError` / `QuotaExhaustedError`
  messages now points at `https://contentrx.io/dashboard`.
- User-Agent bumped to `contentrx-mcp/0.4.0`.
- PyPI homepage URL updated.

### 0.3.0 — 2026-04-22

- Forwards `verdict`, `confidence`, `review_reason` on every violation
  (wired to engine 4.6.0).
- `evaluate_copy` now returns the REVIEW_RECOMMENDED state distinctly.

### 0.2.0 — 2026-04-22

- New tools: `explain_violation(standard_id)` and
  `list_standards(moment=None)`.
- New resources: `contentrx://standards`, `contentrx://standards/{id}`,
  `contentrx://moments`.
- New prompt: `review_ui_copy` — multi-step workflow that classifies,
  evaluates, and summarizes UI copy in a file or diff.

### 0.1.0 — 2026-04-22

- Initial release. Tools: `evaluate_copy`, `classify_moment`.
- Auth via `CONTENTRX_API_KEY` env var.
- Install: `uvx contentrx-mcp`.

---

## CLI — `contentrx-cli` on PyPI

### 0.2.0 — 2026-04-23

- **Default API URL changed** from `https://content-rx.vercel.app` to
  `https://contentrx.io`. Existing 0.1.0 installs keep working — the
  old subdomain stays alive on Vercel indefinitely.
- `DASHBOARD_URL` (used in the key-missing / key-invalid error
  messages) now points at `https://contentrx.io/dashboard`.
- PyPI homepage URL updated.

### 0.1.0 — 2026-04-22

- Initial release. Commands: `contentrx check`, `contentrx check-batch`.
- Stdlib-only HTTP client (no `requests` or `httpx` dependency).
- Auth via `CONTENTRX_API_KEY` env var.
- Exit codes are part of the public API (see README).

---

## GitHub Action — `github-action/`

In-tree today; not yet on GitHub Marketplace. See repo README for the
copy-paste install snippet.

### 2026-04-23

- Default `api-url` input value swapped from `https://content-rx.vercel.app`
  to `https://contentrx.io`. The PR-comment footer links and dashboard
  references now use `contentrx.io`.
- No breaking change — users who've pinned `api-url:` in their workflow
  keep their override; users on defaults get the new canonical URL.

### 2026-04-22

- Comment truncation above 60 KB with a "see logs" fallback (fixes
  GHA-C-01 — GitHub's 65 KB comment ceiling).
- Pagination via `Link: rel="next"` for PRs with > 100 changed files
  (fixes GHA-C-02).
- Committed `package-lock.json`; install step now uses `npm ci`.

---

## Figma plugin — `figma-plugin/`

### 2026-04-23

- `API_BASE_URL` in `ui.html` swapped from `https://content-rx.vercel.app`
  to `https://contentrx.io`. Plugin not yet published to Figma
  Community, so no installed users to migrate.
- `manifest.json` `networkAccess.allowedDomains` now includes BOTH
  `https://contentrx.io` (the new default) and `https://content-rx.vercel.app`
  (transition safety — Figma enforces this whitelist, and keeping both
  means pre-launch dev builds and future users are covered).

### 2026-04-22

- Tailwind `AlertDialog` replaces raw `window.confirm` in the
  api-key-panel and rules client.
- CallbackShell ported to Tailwind dark mode.
- Quota-exhausted banner rebuilt with `createElement` / `textContent` /
  `insertBefore`. Accessibility: `role="alert"`.
- Full ARIA pass: `node-card-header` is a `<button>` with
  `aria-expanded`; progress bars have `role=progressbar` +
  `aria-valuenow` kept in sync via `setProgressBar` helper.
- Clipboard-failure inline message; select-all on the key code.
- `DEV_MODE` flipped to `false` for Figma Community submission.

---

## Docs site — `docs-site/` (live at `docs.contentrx.io`)

### 2026-04-23

- Live at `docs.contentrx.io` with HTTPS. Standards library auto-renders
  from the engine's canonical `standards_library.json`, refreshed on
  every build via a `prebuild` npm script that copies the file into
  `docs-site/lib/`.
- Imports the JSON instead of `readFileSync` so webpack bundles the
  data at build time (PR #37).

### 2026-04-22

- Initial build: 57 SSG pages covering 47 standards across 9 categories
  and 8 moment types. Next.js 15 + MDX.

---

## Monorepo chores

### 2026-04-23

- Renamed `contentrx.app` → `contentrx.io` across docs + email sender
  (PR #33). `docs.contentrx.io` is now the canonical docs domain.
- Added `SECURITY.md` and this `CHANGELOG.md` at repo root.
- `CLAUDE.md` Known Limitations updated — items 2 (quota race) and 3
  (webhook idempotency) marked resolved with citations.

---

## Schema-version policy (reminder)

- **Minor bump** (1.0.0 → 1.1.0): additive field, new endpoint, new
  enum value. Old clients keep working.
- **Major bump** (1.x → 2.0): removed field, changed type, changed
  required-ness. Announced via a `warnings` entry in the envelope for
  at least one full minor cycle before the breaking change ships.
- Deprecations ride in `warnings[]` without bumping the version until
  a minor or major is released.
