# Architecture

**Version:** 4.6.1 — Last updated 2026-04-02
**Counts:** 25 preprocessor checks · 47 standards · 9 categories · 13 moments · 8 content types

Read this before writing any code. This document describes the package structure, module responsibilities, data flow, and conventions. If you're an AI assistant working on this project, this is your map.

## Package structure

```
content-standards-checker/
├── pyproject.toml                          # Build config, dependencies, entry points
├── ARCHITECTURE.md                         # You are here
├── project_narrative.md                    # Full project history and session summaries
├── taxonomy_refinement_log.md              # Granularity gaps surfaced through triage
├── src/
│   └── content_checker/                    # THE PACKAGE — all source code lives here
│       ├── __init__.py                     # Public API: check, check_unfiltered, check_batch, load_standards
│       ├── __main__.py                     # python -m content_checker
│       ├── pipeline.py                     # 5-stage orchestrator (classify → filter → preprocess → scan → validate)
│       ├── preprocess.py                   # Deterministic preprocessor (25 checks, zero API cost)
│       ├── classify.py                     # Content type classifier (LLM + heuristic fallback)
│       ├── filter.py                       # Standards filter (prunes by content type + audience)
│       ├── audience.py                     # Content audience signal (product_ui vs general)
│       ├── moments.py                      # Moment detection + standards weighting (13 moments, Tier 1 heuristic)
│       ├── api_utils.py                    # Shared LLM interface (JSON parsing, retry client, error types)
│       ├── validate.py                     # Validation pass (second LLM call to confirm/reject candidates)
│       ├── batch.py                        # Multi-string batch checking with consistency pass
│       ├── models.py                       # Data contracts: Violation, CheckResult, PipelineMeta, TokenUsage
│       └── standards/
│           ├── loader.py                   # load_standards() — reads and returns the JSON library
│           └── standards_library.json      # 47 standards, 9 categories, with routing metadata
├── tests/
│   ├── conftest.py                         # Shared fixtures (loads standards_library.json)
│   ├── test_preprocess.py                  # 399 preprocessor tests, organized by standard ID (M2 consolidated)
│   ├── test_triage_fixes.py               # 10 tests for classifier "problem"/"issue" removal (v4.3.1)
│   ├── test_apple_patches.py              # 27 tests for e-commerce moment patterns, PRF-11 weights (v4.4.1)
│   ├── test_v442_patches.py               # 82 tests for celebration, trust_permission moments (v4.4.2)
│   ├── test_v450_patches.py               # 42 tests for moment taxonomy, CLR-01 notes, GRM-06 library (v4.5.0)
│   ├── test_v451_patches.py               # compliance_disclosure moment, TRN-04 notes, filter _global (v4.5.1)
│   ├── test_v461_patches.py               # VT-02/CLR-01/VT-01 notes, CON-02 nav exemption, PRF-03 relax (v4.6.1)
│   ├── test_integration_seams.py          # Cross-module data flow tests (standards → filter → moments → pipeline)
│   ├── test_audience.py                    # Audience signal tests (gating, filter, prompt, regression)
│   ├── test_filter.py                      # Filter routing tests (standard counts per content type)
│   ├── test_classify.py                    # Heuristic classifier tests
│   ├── test_validate.py                    # Validation prompt construction tests
│   ├── test_batch.py                       # Batch and consistency checking tests
│   ├── test_models.py                      # Data model serialization tests
│   └── test_api_utils.py                   # Shared LLM interface tests (v4.5.1)
├── evals/
│   ├── run_evals.py                        # Eval runner (library + novel modes)
│   ├── novel_cases.json                    # 41 adversarial generalization cases
│   ├── results/                            # Generated stability reports (gitignored)
│   └── industry/                           # 334 human-annotated real-world cases (gitignored)
│       ├── healthcare_eval_cases.json      # 67 cases from Kaiser Permanente
│       ├── fintech_eval_cases.json         # 52 cases from Stripe
│       ├── apple_eval_cases.json           # 83 cases from Apple (e-commerce)
│       ├── wellsfargo_eval_cases.json      # 50 cases from Wells Fargo (fintech)
│       ├── robinhood_eval_cases.json       # 44 cases from Robinhood (consumer fintech)
│       └── medvi_eval_cases.json           # 38 cases from MEDVi (healthcare DTC)
├── cli/
│   ├── __init__.py
│   └── main.py                             # CLI entry point (content-checker command)
├── figma-plugin/
│   ├── manifest.json
│   ├── code.js                             # Figma sandbox thread (+ audience persistence)
│   └── ui.html                             # Figma UI thread with embedded standards + audience toggle
├── tools/                                  # Private utilities (gitignored)
│   ├── triage.py                           # Interactive triage CLI for scan exports
│   ├── extract_content.py                  # HTML content extractor for eval case creation
│   ├── auto_annotate.py                    # Auto-annotator CLI (machine verdict + calibrated annotation)
│   └── annotator_prompt.py                 # Calibration prompt builder for the auto-annotator
└── .venv/                                  # Python 3.14 virtual environment
```

## Critical conventions

### Imports

All internal imports use the package path:

```python
from content_checker.pipeline import check, check_unfiltered
from content_checker.preprocess import run_preprocess
from content_checker.models import Violation, CheckResult
from content_checker.standards.loader import load_standards
```

Never use bare imports like `from preprocess import ...` or `from checker import ...`. The package is installed via `pip install -e .` and all modules are resolved through `src/content_checker/`.

### The standards library has routing metadata

`standards_library.json` is not just rules and examples. Each standard has fields that the filter uses to route it:

```json
{
  "id": "CLR-01",
  "rule": "Use plain language...",
  "correct": "...",
  "incorrect": "...",
  "rule_type": "nuanced",
  "checkable_from": "plain_text",
  "relevant_content_types": ["error_message", "tooltip_microcopy", "short_ui_copy", "long_form_copy"],
  "content_type_notes": {
    "confirmation": "Passive voice is acceptable for confirmations."
  },
  "version": "4.6.1",
  "version_history": [
    {"version": "4.6.1", "date": "2026-04-23", "change_note": "..."}
  ]
}
```

**If you update the standards library, never replace the whole file.** Use surgical patches that update only `rule`, `correct`, or `incorrect` fields. Replacing the file strips `relevant_content_types`, `content_type_notes`, and the top-level `content_types` array, which breaks the filter and causes 24 test failures.

### Per-standard versioning

Every standard carries `version` and `version_history` (added in the human-eval build plan Session 1). Bumping the rule text, the `correct`/`incorrect` examples, or any `content_type_notes` entry is a per-standard version bump — append an entry to `version_history` with the date and a one-line change note. The library-level top-level `version` remains the authoritative package version for the engine as a whole; per-standard versions are additive metadata so eval records can reproduce against a specific rule revision.

The pipeline stamps `rule_version` on every emitted Violation from the per-standard `version` field at evaluation time (see `_build_rule_version_map` and `_stamp_rule_versions` in `pipeline.py`). The same snapshot populates `rule_versions` on each hop of `CheckResult.rationale_chain`.

When a change is semantic (rule now fires on different conditions, or the decision boundary shifts), the Session 10 graduation ladder resets counterpart credit — classification of semantic-vs-wording changes is owned by the taxonomy refinement log. When a change is wording-only (rephrase, clarity edit, example update), prior counterparts carry at 50% weight. Additive carve-outs (new exception clauses) carry counterparts outside the new exception at full weight.

### The preprocessor returns Violation objects via run_preprocess()

`pipeline.py` calls `run_preprocess(text, content_type)`. This returns a list of `Violation` objects (from `models.py`) with `source="deterministic"`. The list also carries a `.suppressed_ids` attribute — a set of standard IDs the preprocessor definitively passed. The pipeline uses this for post-processing suppression: if the preprocessor says PASS for a standard, any LLM violation for that standard is suppressed.

### The system prompt does NOT mention hard vs. nuanced rules

A previous experiment with `[HARD RULE]` / `[NUANCED]` tags in the system prompt caused accuracy to drop from 99.3% to 96.5%. The hard/nuanced distinction lives in the pipeline architecture (preprocessor handles hard rules, LLM handles nuanced ones), never in the prompt.

## Data flow

```
Input text + audience (product_ui | general)
    │
    ├─ Stage 1: classify (classify.py)
    │     LLM or heuristic → content type (e.g., "error_message")
    │
    ├─ Stage 1b: detect moment (moments.py)
    │     Tier 1 heuristic → moment (e.g., "error_recovery")
    │     Uses text patterns + content type. Zero cost, <1ms.
    │     Skipped if moment was passed explicitly (Tier 3, future).
    │
    ├─ Stage 2: filter (filter.py)
    │     Prunes standards library by content type using relevant_content_types
    │     + audience gate: excludes UI-specific standards in general mode
    │     Returns filtered standards + active content_type_notes
    │     (includes _global notes that apply regardless of content type)
    │
    ├─ Stage 3a: preprocess (preprocess.py)
    │     25 deterministic checks → violations + suppressed standard IDs
    │     Zero API cost, sub-millisecond
    │     Moment-unaware: fires on text patterns regardless of moment
    │
    ├─ Stage 3b: LLM scan (pipeline.py → _llm_scan)
    │     Claude evaluates filtered standards against the text
    │     System prompt includes audience context AND moment context
    │     Moment weights guide emphasis/relaxation of specific standards
    │     Returns raw violations and passes
    │
    ├─ Stage 4: validate (validate.py)
    │     Second LLM call reviews each candidate violation
    │     Uses content_type_notes to catch false positives
    │     Confirms or rejects each candidate
    │
    └─ Stage 5: merge (pipeline.py)
          Preprocess violations (authoritative)
          - audience-suppressed violations (UI-specific in general mode)
          - moment-suppressed violations (suppress weight in detected moment)
          + validated LLM violations (confirmed by stage 4)
          - moment-suppressed LLM violations
          - preprocessor-passed violations (preprocessor said PASS)
          = final result (with audience + moment fields for triage tracking)
```

### Rationale chain (v1.2.0, human-eval build plan Session 1)

Every hop in the pipeline above appends a `RationaleHop` entry to `CheckResult.rationale_chain`. Each hop carries `step`, `inputs` (compact summary of what the stage saw), `output` (compact summary of what it produced), `confidence` (for LLM stages; `None` for deterministic ones), `rule_versions` (standard_id → per-standard version for the rules this hop consulted), and an optional typed `ambiguity_flag`.

When Robo (or any reviewer) sees a wrong verdict, the chain lets them pinpoint which hop went sideways without re-running the pipeline. The chain is also the substrate for Session 21's "Why this verdict" UI on the product surface.

### Typed review_reason subtypes (v1.3.0, human-eval build plan Session 2)

When `CheckResult.verdict == "review_recommended"`, `review_reason` carries one of five typed subtypes — never a generic fallback. The review queue (Session 8) batches by subtype so reviewers see one coherent kind of uncertainty at a time.

| Subtype | Signal | Routing |
|---|---|---|
| `standards_conflict` | Scan proposed ≥1 violation; validate rejected at least one. | Taxonomy refinement log — the disagreement is architectural. |
| `situation_ambiguity` | Moment-classifier confidence below `MOMENT_CONFIDENCE_THRESHOLD` (0.6). | Moment classifier backlog — not a standards-side bug. |
| `out_of_distribution` | Input doesn't resemble training data. *Reserved; emission pending later sessions.* | New-moment / new-content-type candidate pool. |
| `novel_pattern` | Classifier confident but override rate on similar strings climbing. *Reserved; requires override-rate history.* | Drift watchlist. |
| `low_confidence` | Any violation's `confidence < CONFIDENCE_THRESHOLD` (0.7). | Baseline calibration review. |

**Precedence when multiple signals fire:** `standards_conflict` > `situation_ambiguity` > `out_of_distribution` > `novel_pattern` > `low_confidence`. A taxonomy fix often cascades and resolves the downstream signals, so it's worth triaging first. `low_confidence` is the fallback — more specific signals always shadow it.

Signals are passed as kwargs to `derive_verdict` in `models.py`; the pipeline wires two today (`scan_validate_disagreement` from validate's rejected count; `moment_ambiguous` from `detect_moment_with_confidence`). The remaining two kwargs are reserved for future sessions to populate without a schema change.

### In-product signal instrumentation (v1.4.0, human-eval build plan Session 3)

Every override captured by `POST /api/violations/override` now carries four extra signals on top of the existing `override_type` / `override_reason` / `source`:

| Field | Shape | Captures |
|---|---|---|
| `override_stance` | `agree` / `disagree` / `agree_but_overriding` | The user's opinion of the finding. Distinct from `override_type` (what they did with it). |
| `actor_role` | `designer` / `engineer` / `pm` / `other` | Who is giving the signal. Weighted, not gating. Default inferred per source. |
| `rationale_expanded` | boolean | Did the user click to expand the rationale before acting? |
| `time_to_action_ms` | 0–3,600,000 | Elapsed ms from verdict surfaced to user action. |

Plus a **counterfactual triple** when the user rewrote the flagged string: `text` (original) + `suggested_text` (tool's proposal) + `applied_text` (what the user actually shipped). All three are sha256-hashed server-side; raw text never persists. When all three hashes differ, the eval is flagged as `suggestion_rejected_alternative_applied` — derivable from the hashes, not stored.

**Four-quadrant behavior model** (derived, not stored — see `src/lib/behavior-quadrant.ts`):

- **`pattern_match_accept`** — agreed within 2s, rationale NOT expanded. Low individual signal; useful in aggregate.
- **`informed_accept`** — rationale expanded, then agreed. Medium signal.
- **`informed_reject`** — rationale expanded, then disagreed (or shipped anyway). Highest-signal reject — primary feed for the taxonomy refinement log.
- **`reflex_reject`** — rejected within 2s without expanding. Lowest-signal reject.

The dashboard `/dashboard/overrides` surfaces the quadrant tally per team over a 30-day window. Pre-Session-3 rows fall into `unknown`.

Surface coverage as of Session 3: the Figma plugin is fully wired (three-button stance row + collapsible rationale + timing). CLI and MCP remain queued for follow-up sessions — they're non-interactive surfaces that need separate interaction design before they can submit overrides.

### Two-vocabulary pattern for overrides (v1.5.0, human-eval build plan Session 4)

User override reasons and Robo's `triage_category` are two distinct vocabularies that feed two distinct loops. They are reconciled case-by-case during review, not translated mechanically.

**User reason codes** (stored in `violation_overrides.override_reason_code`, defined in `src/lib/override-reasons.ts`):

| Code | User-facing label | Typical `triage_category` on review |
|---|---|---|
| `not_applicable_here` | Not applicable here | `context_gap` |
| `standard_too_strict` | Too strict for this case | `missing_standard` |
| `fix_is_worse` | Suggested fix is worse | `misclassification` |
| `shipping_anyway` | I agree — shipping anyway | `correct` |
| `confusing_need_more_context` | Confusing, need more context | `missing_standard` |

**Robo's `triage_category`** (from `EVAL_PROTOCOL.md`): `correct`, `misclassification`, `hallucination`, `missing_standard`, `context_gap`.

The "typical" column is a prior, not a promise. A user's `not_applicable_here` usually becomes `context_gap` on Robo's review, but sometimes becomes `misclassification` when the situation detector was right and the user misread the flagged string. The reconciliation is Session 8's job; Session 4 just captures the raw user signal.

**Why two vocabularies?** User codes inform UX, weighting, and which items escalate to Robo's queue. Triage categories drive architectural responses (classifier work, standards library gap, audience/moment gating). Collapsing them into one vocabulary would force users to think like engine authors — and would deny Robo the room to decide that a user's "not applicable" actually isn't a gap at all.

### Session aggregation (v1.5.0, Session 4)

Three or more overrides on the same standard inside one session collapse to a single `standard_pushback` entry in the review queue. Threshold is the plan-spec default (`DEFAULT_PUSHBACK_THRESHOLD = 3`). Individual rows are preserved for drill-down; only the queue rendering changes.

**Session boundaries:**
- **Figma plugin** — one session per scan (`fig-<ts>-<rand>`, regenerated in `renderBatchResults`).
- **CLI / CI / dashboard** — clients supply their own `session_id` per run or per tab. Spec-compliant but not yet wired.
- **Fallback** — rows without a `session_id` pseudo-session by `(user_id, 10-minute-window)` so legacy traffic still aggregates sensibly.

Aggregation is pure-logic, done on read (see `src/lib/session-aggregation.ts`) — no extra table, no write-path branching. Grouping key is `${sessionKey}|${standardId}`.

### Held-out golden set (human-eval build plan Session 5)

The held-out set is a 100-case reference list carved from the annotated industry corpus at `evals/industry/` (gitignored private data). The manifest lives at `evals/held_out/manifest.json` and is committed; the raw case text stays in the source files.

Two jobs:

1. **Blocking CI gate (Session 6, pending).** `tools/run_held_out.py` executes the manifest against the engine and fails any disagreement. Approvals land as `held-out-update:`-prefixed commits that update the stored verdict with a reason.
2. **`/accuracy` denominator (Session 24, pending).** Public κ + 95% CI over a fixed pool, reproducible and not cherry-picked.

Distinct from `evals/novel_cases.json` — that's the library-regression gate (adversarial synthetic data testing *rules*; ≥98% threshold). Held-out tests the *engine* on production-like data with κ, not hit rate. Two gates, two failure modes, no duplication.

**Selection (in `tools/select_held_out.py`):**

- Eligibility: `human_confidence == "high"` AND `review_status in {approved, revised}`.
- Pass 1: every moment with ≥5 eligible cases gets ≥5 slots (capped at budget).
- Pass 2: every standard with ≥3 eligible cases gets ≥3 slots (capped at budget).
- Pass 3: source-proportional largest-remainder allocation.
- Pass 4: fill residual gaps in deterministic order.

Deterministic by construction — same eligible pool + same args always produce the same manifest. Growth is stable: adding cases to the pool doesn't churn the existing selection (cases are sorted by `(source_file, case_id)` within each bucket).

**Case_id synthesis.** About one-third of eligible cases (Wells Fargo, Robinhood, MEDVi) ship with null `case_id`. The loader synthesizes `auto:<source_file>:<1-based-index>` — stable as long as source files aren't reordered. The corpus should grow real IDs over time; the `auto:` prefix makes it auditable.

**Coverage gaps as of 2026-04-23:** `compliance_disclosure`, `destructive_action`, `confirmation`, `empty_state`, `interruption` — zero eligible cases, so held-out can't represent them yet. The selection tool skips these moments rather than lowering the threshold; they re-enter automatically when annotation lands.

**Retirement (not yet exercised):** bounded steady-state of 150 items; past that, retire 10 oldest low-signal items before adding new. Retired standards keep their held-out items as archive-flagged (queryable, non-gating). Taxonomy splits add one item per side to the manifest.

### Held-out CI gate (human-eval build plan Session 6)

The gate runs on every PR touching the engine, the standards, the held-out manifest, or the held-out tooling. Two jobs (`.github/workflows/held_out.yml`):

1. **Commit-message convention (`convention` job).** Fast + free, no corpus needed. Walks every commit in the PR. If a commit edits `evals/held_out/manifest.json` or anything under `evals/industry/`, the subject line must start with `held-out-update: <reason>`. Enforced by `scripts/check_held_out_convention.py`.
2. **Held-out run (`held-out` job).** Fetches the private corpus from `HELD_OUT_CORPUS_TARBALL_URL` (GH Actions secret), invokes `tools/run_held_out.py`, fails on any disagreement. Requires `ANTHROPIC_API_KEY` for pipeline execution. Current state: wired but not enabled — the workflow emits a notice and exits cleanly when either secret is missing, so the gate is never silently bypassed.

**Why two jobs, not one.** The convention job is the always-on enforcement — catches held-out verdict edits in seconds without touching the private corpus. The execution job is opt-in because it depends on ops work (corpus tarball URL, API key) the repo owner chooses when to enable. Decoupling means the convention check protects the manifest from day one; the execution check flips on when Robo is ready.

**No env-var bypass.** The only path past a failing gate is a real `held-out-update:` commit that resolves the disagreement by updating the verdict with a documented reason. Approval ceremony is documented in `docs/HELD_OUT_GATE.md`.

### Quarterly self-drift check (human-eval build plan Session 7)

Cohen's κ between past-Robo verdicts and a blind re-labeling pass on the same cases, quarterly. The resulting **measured ceiling** is the single most important number in the graduation ladder — Session 10's thresholds recalibrate as a ratio of the ceiling each cycle.

Three-step cadence (one per quarter, all in `tools/drift_check.py`):

1. **`build-panel`** — 80-case stratified sample from the eligible pool across `(moment, content_type)`. Largest-remainder allocation; deterministic; stable under corpus growth (same case_ids come out as the pool expands).
2. **`export-blind`** — strips past verdicts + rationale so re-labeling isn't anchored. Keeps the task context (text + content_type + moment + standard_id). Session 8's review-queue UI consumes this format directly.
3. **`score`** — computes κ + 95% CI via Fleiss standard-error, per-standard disagreement breakdown, implicated-standards list for the refinement-log triage, and the threshold regime.

**Threshold ratios (plan-spec constants):**

| Threshold | Formula | Value at 0.90 target |
|---|---|---|
| Autonomous κ | `0.94 × measured_ceiling` | 0.85 |
| Batch-approval κ | `0.83 × measured_ceiling` | 0.75 |

**Regime table (Session 10 branches on this):**

| Measured ceiling | Regime | Consequence |
|---|---|---|
| ≥ 0.90 | `target_met` | Ship normally |
| 0.85 – 0.90 | `maturing` | Taxonomy-stabilization review required before new autonomous graduations |
| 0.80 – 0.85 | `graduation_frozen` | No new autonomous graduations |
| < 0.80 | `degraded` | Existing autonomous standards re-reviewed next cycle |

**Coverage gap:** the eligible pool is currently missing 4 moments (destructive_action, confirmation, empty_state, interruption). Drift measurement for those is impossible until annotation lands. Stratification skips missing moments rather than lowering the quota — the next `build-panel` run picks them up automatically when they appear.

The panel, blind, and report files all live in `evals/drift/`. The README there is the canonical workflow doc for Robo's quarterly cycle.

### Production override review queue (human-eval build plan Session 8)

Turns real-user override events (`violation_overrides`) into an ordered, batched queue that Robo reviews via the existing Phase 2 CLI (`tools/triage.py`). Target: 50 items in 60 minutes.

**Stage-aware ordering (phase auto-detects from precedent-index size):**

| Phase | Trigger | Focus |
|---|---|---|
| `early` | `<500` high-confidence `(standard, content_type, verdict)` tuples | **Exploration.** Novel combinations first — each labeled case fills a new cell in the precedent index. |
| `late` | `≥500` high-confidence tuples | **Exploitation.** `standards_conflict` first — taxonomy bugs are the highest-remaining-value failure mode once the index is populated. |

Outer dimension: `audience` (provisional). The ditto_roadmap eval suggested general-audience content concentrates false positives on a 12-case sample. Session 8 formalizes a re-test at 50 annotated general-audience cases (`tools/audience_retest.py`): keep audience-first if `P(general | FP) ≥ 40%`; otherwise drop and let subtypes drive batching directly.

**Within-phase ordering:**

```
Early:   audience → novel_combinations → standards_conflict →
         ensemble_disagreement → standard_pushback → calibration(5%)

Late:    audience → standards_conflict → ensemble_disagreement →
         novel_combinations → standard_pushback → calibration(10%)
```

Batches are size-3 clusters matching `triage.py`'s agree/override/skip UI. They never cross audience boundaries — when the outer bucket flips, the current batch closes even if it's under-sized.

**Pattern detection + refinement-log draft.** After each batch, `tools/batch_summary.py analyze` counts actions and flags `recurring_standard_override` when 3+ overrides land on the same standard. `batch_summary.py draft-refinement` appends a candidate entry to `taxonomy_refinement_log.md` under "Open refinements" in the existing format, marked pending auto-detected — Robo triages during the weekly cadence and promotes to approved only after the two-source rule.

**Calibration sample.** A random sample of high-confidence annotated cases mixes into each queue (5% early, 10% late). Seeded, so re-builds over the same pool are reproducible.

**Deferred:** web review-queue surface (today CLI-only via `triage.py`); direct DB integration for the queue builder (today reads a JSON dump).

### Review cadence dashboards (human-eval build plan Session 9)

Three web surfaces under `/dashboard/cadence/*` plus a weekly email digest. Team-plan gated, admin-only (mirrors `/dashboard/overrides`).

| Surface | Path | Cadence | What it shows |
|---|---|---|---|
| Daily | `/dashboard/cadence` | 15 min | Top-of-queue + urgent flags (last 24h vs prior 7-day average) + pointers to weekly + monthly |
| Weekly | `/dashboard/cadence/moment/[moment]` | 60 min | Override stream for one moment; 13-week rotation auto-picks `momentForWeek(today)` |
| Monthly | `/dashboard/cadence/calibration` | — | Latest drift report (κ + CI + regime from `evals/drift/reports/*.json`) |
| Email | `/api/cron/weekly-digest` | Weekly | Team admins; Resend + Redis dedupe on `(team, ISO-week)` |

Pure logic lives in `src/lib/cadence.ts`: `momentForWeek`, `detectUrgentFlags`, `aggregateVelocity`, `buildWeeklyDigest`. Server components handle SQL; no client-side data fetching. Vitest covers every helper.

**Urgent-flag signals:**
- **`override_rate_spike`** — today's count ≥ `spikeMultiplier` × prior-7-day daily average AND ≥ `minAbsoluteCount`. Defaults: 3×, 3 overrides.
- **`new_out_of_distribution_cluster`** — standard has ≥3 overrides today and zero in the prior 7 days.

**Moment rotation** uses ISO week + a year offset so January 2027 doesn't land on the same moment as January 2026. All 13 moments surface at least once every 13 weeks.

**Cron enablement.** The workflow is in place; the user flips it on by adding `vercel.json` crons + a `CRON_SECRET` env var. Route exits 503 if the secret isn't configured — never silently pass.

**Deferred:** MCP surfacing of the cadence data (separate future session); pending-refinement count in the digest (Session 34's auto-detector populates this).

### Graduation ladder (human-eval build plan Session 10)

Three levels per standard: `robo_labels` → `batch_approval` → `autonomous`. All promotions require **all six hard-gate criteria** to pass — AND-ed, not averaged. Full policy in `evals/graduation/README.md`; implementation in `tools/graduation_metrics.py`.

| # | Criterion | Autonomous | Batch-approval |
|---|---|---|---|
| 1 | Sample size (4-week agreements) | ≥ 500 | ≥ 200 |
| 2 | Cohen's κ vs Robo | ≥ `0.94 × ceiling` | ≥ `0.83 × ceiling` |
| 3 | Raw agreement (McHugh floor) | ≥ 80% | ≥ 70% |
| 4 | MCC (when prevalence < 15%) | ≥ 0.70 | ≥ 0.60 |
| 5 | Production override rate (actor-weighted) | < 5% | < 10% |
| 6 | Counterpart tier + variation + ≥80% pass rate | required | required |

**Stability window:** 4 weeks. Every weekly κ bucket must meet the threshold — not just the average. A standard that just crossed doesn't graduate; the ladder waits for stability.

**Sample tightening:** 100–200 agreements → κ threshold +0.02 (wider SE). <100 → graduation blocked regardless of κ.

**Counterpart tier** by observed prevalence: <15% → 5 counterparts, 15–40% → 8, >40% → 12. Structurally complex rules add +3. **Structural variation** requires ≥2 of 3 axes with within-moment mandatory (≥60% within-moment-within-type, ≥25% cross-content-type, ≥15% cross-moment).

**MCC supplementation** for low-prevalence standards addresses the Cohen's-κ prevalence paradox (Chicco et al. 2021). κ stays default; MCC is additive, not replacement.

**Actor-weighted override rate** multipliers: designer 1.5, PM 1.0, engineer 0.75, other/unknown 1.0.

**Rule-version counterpart credit** (per-standard versioning from Session 1):

| Change kind | Counterpart credit |
|---|---|
| Semantic (rule fires differently) | Full reset |
| Wording-only (rephrase / examples) | 50% weight |
| Additive carve-out | Outside carve-out full; inside needs re-verification |

**DB state.** `graduation_status` table keyed by `standard_id` stores current level + last readiness snapshot + append-only history. `src/lib/graduation.ts` exposes read/write helpers. Session 11 wires the approval UI on top; Session 12 wires the auto-demotion monitor.

**Today's baseline:** 43 standards evaluated, all at `robo_labels` (no production reviews yet). The committed `evals/graduation/readiness.json` gives downstream sessions a real input to develop against.

### Graduation approval UI (human-eval build plan Session 11)

One-screen approval surface for eligible promotions. Admin-gated via `CONTENTRX_ADMIN_CLERK_IDS` — a comma-separated allow-list of Clerk user IDs. Unset = no one can approve (safe default in prod).

**Pages:**
- `/dashboard/graduation` — server component. Reads the committed `evals/graduation/readiness.json` + current `graduation_status` rows from the DB. Renders eligible standards with criteria pills + consequence text; non-eligible standards grouped by current level in a read-only breakdown.

**API:**
- `POST /api/graduation/approve` — admin-gated. Validates the target is a strict promotion from the current level (not a demotion, not a no-op). Writes via `recordLevelChange` (Session 10) so history stays append-only.

**Approval UX:** the approve button prompts for a short reason before posting. The reason + the full readiness snapshot land on the history entry for the audit trail.

**Deferred:** auto-demotion (Session 12 watches the 2-week override rate and steps standards down when it breaches). Manual demotion UI lands in the same session.

## Two entry points, two use cases

`check(text, content_type, audience)` — full 5-stage pipeline. Used in production, the CLI, and the Figma plugin. Content-type-aware filtering and audience-aware gating reduce false positives. Audience defaults to `product_ui`.

`check_unfiltered(text)` — preprocess + single LLM call with all 47 standards. No filtering, no validation, no audience gating, no moment detection. Used for library evals where synthetic test strings need the full rulebook without content type or audience context.

## Preprocessor design (preprocess.py)

25 checks, three possible outcomes each:

| Outcome | Meaning | What happens |
|---|---|---|
| VIOLATION | Definite problem | Added to final violations |
| PASS | Definitely fine | Suppresses any LLM violation for this standard |
| DEFER | Can't tell | Standard goes to LLM |

10 standards-based checks: GRM-01 (Oxford comma), GRM-02 (abbreviation allowlist, pass-only), GRM-03 (exclamation points), GRM-04 (ampersands, content-type-aware), GRM-05 (numerals, with unicode hyphen normalization and safe context matching), GRM-06 (compound modifier hyphenation, numeric + spelled-out patterns), CON-02 (sentence case, pass-only, with 20-phrase safe allowlist), CON-03 (date formats), ACT-01 (binary response buttons, pass-only).

11 proofing checks: PRF-01 (double spaces, with data display pipe exception), PRF-02 (repeated words), PRF-03 (trailing period on headings), PRF-04 (straight quotes, with inch mark exception), PRF-05 (missing space after punctuation), PRF-06 (leading/trailing whitespace), PRF-07 (space before punctuation), PRF-08 (placeholder text), PRF-09 (all caps), PRF-10 (Latin abbreviations), PRF-11 (dismissive language: simply, easily, effortlessly, just + verb, easy/simple + noun).

2 clarity checks: CLR-01 (redundant phrases), CLR-01 (banned words).

1 accessibility check: ACC-01 (vague link text).

2 inclusion checks: INC-01 (gendered language), INC-02 (non-inclusive tech terminology).

### GRM-05 unicode hyphen normalization (v4.4.2)

The GRM-05 check normalizes U+2011 (non-breaking hyphen) and U+2010 (hyphen) to U+002D (hyphen-minus) before safe context matching. Apple product pages render hyphens as U+2011, so "one‑year" wouldn't match the safe context "one-year" without normalization.

Safe contexts for "one" include: number one, one of, one more, one time, one day, one way, one thing, one another, one by one, one at a time, no one, any one, every one, each one, this one, that one, which one, someone, anyone, everyone, one on one, one-on-one, one-way, one app, one year, one-year, applecare one.

### GRM-06 compound modifier hyphenation (v4.5.0)

Detects unhyphenated compound modifiers before nouns. Two pattern families:

**Numeric compounds:** `\d+\s+(day|week|month|year|hour|minute|step|mile)s?\s+\w+` where the trailing word is a noun (not a preposition like "of", "in", "ago", "later", "left", "each"). Flags "5 day streak" → suggests "5-day streak". Plural units are normalized in the suggestion ("30 days trial" → "30-day trial").

**Spelled-out compounds:** A curated list of common compounds: real time, high quality, low cost, well known, user friendly, long term, short term, full time, part time, first time, high level, low level, end to end, step by step, one on one, state of the art, out of the box, up to date, day to day. Each has a unique hyphenated form. Fires only when followed by a noun (checked against a 40-word noun allowlist: updates, data, monitoring, job, etc.).

Both patterns can VIOLATE (unhyphenated before a noun), PASS (correctly hyphenated), or DEFER (ambiguous position — not clearly modifying a noun).

### CON-02 safe phrase allowlist (v4.5.0)

The CON-02 sentence case check now has a 20-phrase early-return allowlist for intentional title-case conventions in UI copy: Log In, Sign Up, Sign Out, Log Out, Terms of Service, Privacy Policy, Terms and Conditions, Terms & Conditions, Terms of Use, Cookie Policy, Data Policy, Home Page, Get Started, Learn More, Read More, View All, Show More, Show Less, Load More, See All. When the input text exactly matches a safe phrase (case-insensitive), CON-02 returns PASS without checking case patterns.

### PRF-01 data display exception

The `_DATA_DISPLAY_PIPE` regex recognizes padded pipe separators in data visualizations (e.g., `63.6%  |  4.7M`) as intentional formatting. Uses lookbehind/lookahead to confirm data-like characters on both sides. Strips these patterns before the double-space check so only genuine double spaces are flagged. Added from Opendoor triage Cluster 2.

### ACT-01 binary response exception

Pass-only preprocessor check for standalone response buttons (Yes, No, OK, Cancel, Dismiss, Got it, Not now, etc.). Same architectural pattern as GRM-02 — can ONLY pass, never flag. Handles compound confirmations ("Yes, delete") with a 5-word length guard to prevent false passes on full sentences. Added from Opendoor triage Cluster 4.

### Classifier "problem"/"issue" removal

"problem" and "issue" were removed from the heuristic classifier's error signal list. These words appear frequently in instructional/presentation content and triggered false error_message classification. Accepted tradeoff: heuristic-only false negatives on rare error messages that use only "problem" as their signal. The LLM classifier is the primary path and still catches these. Added from Opendoor triage Cluster 6.

## Content audience signal (audience.py)

Addresses the 31% context_gap finding from the first human evaluation batch (26 Opendoor cases). The tool's standards are calibrated for product UI, but users also evaluate presentations, documents, and marketing content where UI-specific rules create false positives.

### Two modes

| Mode | When to use | Effect |
|---|---|---|
| `product_ui` | Buttons, labels, errors, tooltips, onboarding — user-facing product UI | Full standards enforcement (default, no behavior change) |
| `general` | Presentations, docs, marketing pages, internal content | UI-specific standards suppressed; universal quality standards apply |

### UI-specific standards (suppressed in general mode)

Each suppression is individually justified by triage evidence:

| Standard | Why suppressed | Triage evidence |
|---|---|---|
| ACT-01 | "Start with a verb" doesn't apply to non-UI headings | 8 false positives on presentation instructions |
| PRF-03 | Presentations use trailing periods on complete-sentence headings | 1 misclassification (subtitle as ui_label) + REF-001 |
| CON-02 | Title case is intentional in presentations and marketing | Connected to Cluster 1 (25 failures) |

To add a new suppression: (1) identify the standard from triage data, (2) verify ≥3 confirmed context_gap cases, (3) add to `UI_SPECIFIC_STANDARDS` in audience.py, (4) add test in test_audience.py, (5) document here.

### Content-type overrides for audience suppression (v4.6.1)

Some standards are suppressed in general mode but must remain active for specific content types. These overrides live in `_AUDIENCE_CONTENT_TYPE_OVERRIDES` in filter.py (for LLM-path standards) or would require merge-stage logic (for preprocessor-only standards).

**Active overrides:**

| Standard | Content type | Why override | Evidence | Mechanism |
|---|---|---|---|---|
| CON-02 | ui_label | Nav labels are structural UI regardless of surrounding content surface. | RH-042 (1 false negative) | filter.py |

**Audit of candidate overrides (v4.6.1, 0 eval cases each — monitor):**

| Standard | Content type | Rationale | Blocked by |
|---|---|---|---|
| ACT-01 | button_cta | Buttons should start with verbs regardless of audience context | Classifier: presentation slide labels get classified as button_cta. Fix the classification, not the override. |
| ACT-01 | ui_label | Nav labels that happen to be verbs ("Settings" → wayfinding handles this) | Wayfinding moment already suppresses ACT-01. Redundant. |
| CON-02 | button_cta | "Get Started" in title case — conventional on marketing CTAs | Ambiguous. Marketing CTAs legitimately use title case. 0 cases. |
| PRF-03 | ui_label | "Settings." with trailing period would be wrong anywhere | Would require merge-stage override logic (PRF-03 is preprocessor-only). 0 cases. |

**Two suppression paths:** Standards in the library (CON-02, ACT-01) are suppressed at the filter stage — `_AUDIENCE_CONTENT_TYPE_OVERRIDES` handles re-inclusion. Standards that are preprocessor-only (PRF-03) are suppressed at the pipeline merge stage — content-type overrides there would need merge-stage logic in pipeline.py, not filter.py. No preprocessor-only override is currently warranted.

To add a new override: (1) identify from eval data that a standard is incorrectly suppressed for a specific content type, (2) determine whether the standard uses the filter path or merge-stage path, (3) add to `_AUDIENCE_CONTENT_TYPE_OVERRIDES` in filter.py (filter path) or add merge-stage logic in pipeline.py (preprocessor path), (4) add test, (5) document here.

### How the audience propagates

```
Plugin UI toggle (audience-select dropdown)
    │
    ├─ filter.py     → Excludes UI-specific standards from the filtered set
    │                   (they never reach the LLM in general mode)
    │
    ├─ pipeline.py   → Injects audience context into the system prompt
    │                   (calibrates LLM judgment for the content surface)
    │
    ├─ pipeline.py   → Merge stage suppresses preprocessor violations
    │                   for UI-specific standards in general mode
    │                   (handles PRF-03 deterministic violations)
    │
    ├─ models.py     → CheckResult.audience field for triage export
    │                   (enables evaluation tracking per audience mode)
    │
    └─ code.js       → Persisted per Figma file via clientStorage
                        (user sets once, sticks across sessions)
```

### Design decisions

**The filter gatekeeps, not the standards library.** UI-specific standard IDs are defined in `audience.py` as a frozenset rather than adding `audience_scope` metadata to `standards_library.json`. This keeps the JSON file stable (never replace wholesale) and makes the gating logic testable. Can migrate to library metadata later once the feature is validated.

**Default is always `product_ui`.** Callers that don't pass an audience parameter get exactly the pre-feature behavior. Unknown audience values also default to `product_ui` — safety-by-default means full enforcement, not relaxed.

**Preprocessor stays audience-unaware.** The preprocessor runs the same checks regardless of audience. Audience gating happens in the pipeline's merge stage, which filters out preprocessor violations for suppressed standards. This keeps the preprocessor focused on text-level correctness and puts all audience policy in one place.

### Tier 2: automatic audience detection (future, not built)

Designed but not implemented. Options:
1. Infer from Figma page/frame names (e.g., "Presentation", "Deck", "Slides" → general)
2. Infer from content distribution patterns (many short headings, few interactive elements → general)
3. Combination with a confidence threshold that falls back to the user toggle

Build this after the manual toggle has enough triage data to validate the suppression list.

## Moment pipeline integration (moments.py)

Moments encode WHERE THE PERSON IS in their experience and change how standards are evaluated. Content type tells you WHAT a string is (heading, button, error). Moment tells you WHY it exists (confirming success, recovering from error, making a decision).

### The 13 canonical moments

| Moment | Description | Weight count |
|---|---|---|
| `first_encounter` | Onboarding, setup, first-run. Clarity above all. | 5 |
| `browsing_discovery` | Homepages, landing pages, feature tours. Scannability matters. | 1 |
| `decision_point` | Pricing, plan selection, upgrade prompts. No dark patterns. | 5 |
| `task_execution` | Form filling, configuration, multi-step flows. Actionable labels. | 4 |
| `confirmation` | Success, saved, completed. Brevity, passive voice is fine. | 3 |
| `celebration` | Achievement, milestone, streak. Enthusiasm is earned, not excessive. | 5 |
| `error_recovery` | Validation, system errors, failed states. No blame, clear next step. | 8 |
| `destructive_action` | Delete, cancel, irreversible. Explicit consequences, friction OK. | 4 |
| `empty_state` | Zero data, no results. Helpful, suggest next action. | 4 |
| `interruption` | Modals, toasts, notifications. Brevity critical, clear dismiss. | 3 |
| `trust_permission` | Permissions, consent, verification. Precision over warmth, hedging OK. | 4 |
| `wayfinding` | Navigation, breadcrumbs, section labels. Consistency, space-constrained OK. | 4 |
| `compliance_disclosure` | Regulatory disclaimers, FDIC notices, legal mandates. Mandated language takes precedence. | 2 |

19 of 47 standards have at least one moment weight. 57 total weight entries across all moments.

### How moments flow through the pipeline

```
Text + content type
    │
    ├─ detect_moment()        → Tier 1 heuristic (text patterns + content type)
    │                            Zero cost, <1ms. Returns one of 13 canonical moments.
    │
    ├─ build_system_prompt()  → Moment section injected into LLM prompt
    │                            Tells the LLM to emphasize/relax/suppress
    │                            specific standards for the detected moment.
    │                            Empty for browsing_discovery (the default).
    │
    ├─ merge stage            → is_standard_suppressed_by_moment()
    │                            Filters out violations for standards with
    │                            "suppress" weight in the detected moment.
    │                            Same pattern as audience gating.
    │
    └─ CheckResult            → moment field for triage tracking
                                 PipelineMeta includes moment_weights_applied
                                 and moment_suppressed counts.
```

### Detection priority order

The `detect_moment()` function checks patterns in this order. Earlier matches win. More specific moments must come before their general parents.

1. destructive_action (highest specificity)
2. error_recovery
3. celebration (before confirmation — "Congrats" is more specific than "saved")
4. confirmation
5. empty_state
6. first_encounter
7. trust_permission (before decision_point — "allow" is consent, not choice)
8. decision_point
9. interruption
10. wayfinding
11. task_execution
12. compliance_disclosure (v4.6.0)
13. browsing_discovery (default fallback)

Priority disputes are resolved by specificity. If a string matches both celebration and confirmation patterns, celebration wins because it's checked first and is a narrower category.

### The three modifiers

| Modifier | Who handles it | Effect |
|---|---|---|
| `suppress` | Merge stage (deterministic) | Violation is removed from final results |
| `emphasize` | LLM via system prompt | LLM flags the standard more aggressively |
| `relax` | LLM via system prompt | LLM accepts minor deviations |

**Critical design decision:** Only `suppress` is deterministic. `emphasize` and `relax` are LLM guidance — they change how strictly the LLM evaluates, but they don't override the LLM's judgment. This means:
- Suppression is testable and reproducible (same input → same suppression).
- Emphasis and relaxation are probabilistic (the LLM may or may not change its call).
- The eval protocol should track moment-influenced verdicts separately.

### PRF-11 moment gating

PRF-11 (dismissive language: "simply," "easily," "effortlessly," "just + verb," "easy/simple + noun") is the first standard gated by moment rather than audience. The preprocessor fires on the text pattern regardless of moment. The merge stage suppresses the violation when the moment is `browsing_discovery`, `decision_point`, or `celebration`.

| Moment | PRF-11 behavior | Why |
|---|---|---|
| `browsing_discovery` | Suppressed | Marketing copy uses "easy" as a value proposition |
| `decision_point` | Suppressed | "Easy to switch" is a legitimate claim at purchase time |
| `celebration` | Suppressed | "Effortlessly" is legitimate in achievement contexts |
| `task_execution` | Emphasized | "Simply enter your email" trivializes a task |
| `error_recovery` | Emphasized | "Simply try again" blames the user |
| `first_encounter` | Emphasized | New users need confidence, not dismissal |
| All others | Default (fires if detected) | No moment weight → preprocessor verdict stands |

### Celebration moment (v4.4.2)

Celebration is an earned emotional beat — enthusiasm is correct, not excessive. "Congrats!" in a streak notification is not a GRM-03 violation. Detected by signals like "congrats," "milestone," "streak," "level up," "unlocked," "badge."

Priority: checked BEFORE confirmation in the detection chain. "Congratulations! Your account has been created." is celebration, not generic confirmation.

| Standard | Weight | Why |
|---|---|---|
| GRM-03 | relax | Exclamation marks are earned in celebrations |
| PRF-11 | suppress | "Easy" and "effortlessly" are legitimate in achievement contexts |
| VT-05 | emphasize | Celebration copy should feel genuinely warm |
| VT-02 | emphasize | Use "you/your" — this is the user's achievement |
| VT-03 | emphasize | Robotic tone undermines celebration. This copy should feel human |

### Trust/permission moment (v4.4.2)

VT-04 (hedging) inverts here: "This may affect your data" is legally required precision, not weak writing. Detected by signals like "allow access," "agree to terms," "verify your identity," "enable notifications," "privacy policy," and the iOS pattern "would like to access."

Priority: checked BEFORE decision_point. "Allow access" is consent, not a pricing decision.

| Standard | Weight | Why |
|---|---|---|
| CLR-01 | emphasize | Users can't consent to what they don't understand |
| VT-04 | relax | Hedging is precision in consent contexts, not weakness |
| ACT-01 | emphasize | Permission actions must be unambiguous ("Allow" vs "Deny") |
| TRN-01 | emphasize | Trust copy must be transparent about what happens next |

**Design note: VT-04 inversion.** This is the first standard whose semantic meaning flips by moment. In most contexts, hedging is weak writing. In trust/permission, hedging is legally required precision. The "relax" modifier handles this at the LLM level. If eval data shows VT-04 still fires inappropriately in trust contexts, upgrade to "suppress."

### Compliance disclosure moment (v4.6.0)

Regulatory disclaimers use mandated language that content standards shouldn't override. "Not Insured by the FDIC" uses Title Case by convention — CON-02 should not flag it. "Qualification period" is legally mandated precision, not jargon — CLR-01 should tolerate it.

Detected by signals like "FDIC," "FINRA," "SEC" (word-bounded to avoid "section"/"secure"), "not insured," "investment products," "terms and conditions," "qualification period," "may lose value," "not a deposit."

Priority: checked AFTER task_execution but BEFORE browsing_discovery. Less specific than task patterns, but must be caught before the default absorbs it. Short ui_labels (≤4 words) with compliance signals will be caught by wayfinding first — this is correct because the classifier should route those as short_ui_copy, not ui_label.

| Standard | Weight | Why |
|---|---|---|
| CON-02 | suppress | Regulatory disclaimers use Title Case by convention or legal mandate |
| CLR-01 | relax | Legal and financial terms may be mandated precision, not jargon |

Evidence: WF-011 (FINRA disclaimer Title Case), WF-012 (FDIC disclosure Title Case), WF-017 ("qualification period" is mandated, not jargon).

### E-commerce decision patterns (v4.4.1)

The Tier 1 heuristic was expanded with retail/e-commerce decision signals from Apple Store eval data. These patterns detect `decision_point` moments that the original SaaS-focused patterns missed: trade-in, interest-free, save up to, monthly installments, education pricing, financing, credit toward.

### Design decisions

**The preprocessor stays moment-unaware.** The preprocessor runs the same checks regardless of moment. Moment gating happens in the pipeline's merge stage, which filters out preprocessor violations for suppressed standards. This keeps the preprocessor focused on text-level correctness and puts all moment policy in one place (the merge stage), alongside audience policy.

**Default moment is always browsing_discovery.** Callers that don't detect or pass a moment get the baseline evaluation. The default moment returns an empty prompt section — no extra instructions for the LLM.

**check_unfiltered() has no moment.** Library evals test standards in isolation without content type or moment context. Moment detection requires a content type, so the unfiltered path skips it.

### Tier 2 and Tier 3 (not built)

**Tier 2: Frame-level inference.** Uses grouped strings from the same Figma frame to infer moments. A card with a price, a product name, and a CTA button is a `decision_point` even if no individual string matches the pattern. Requires the Figma plugin to pass frame context.

**Tier 3: User-declared.** A dropdown in the plugin UI that overrides auto-detection. Passed as the `moment` parameter to `check()`. Persisted per file via `figma.clientStorage`. Build after triage data validates the auto-detection accuracy.

## Triage CLI (tools/triage.py)

Interactive terminal tool for human review of ContentRX scan exports. Zero dependencies, works on any machine with Python 3.9+. Four-layer architecture (display, data, input, flow) with atomic saves after every reviewed case.

Triage categories map to architectural responses:

| Category | Meaning | Architectural response |
|---|---|---|
| `correct` | Machine got it right | No action |
| `misclassification` | Wrong content type | Classifier work |
| `hallucination` | LLM invented a violation | LLM/validation issue |
| `missing_standard` | Standards library gap | Add standard |
| `context_gap` | Tool lacks needed context | Audience signal, moments, etc. |

## Auto-annotator (tools/)

The auto-annotator pre-fills eval case annotations at scale. It takes raw extracted content (from `extract_content.py` or a URL), runs each case through the checker pipeline, then uses a calibrated LLM pass to generate human-style annotations.

### Files

| File | Purpose |
|---|---|
| `tools/auto_annotate.py` | CLI orchestrator. Two-stage pipeline: machine verdict → calibrated annotation. |
| `tools/annotator_prompt.py` | Calibration prompt builder. Selects diverse few-shot examples from existing annotations. |
| `tools/extract_content.py` | HTML content extractor (pre-existing). Outputs cases with null annotation fields. |

### Two-stage process

**Stage 1: Machine verdict.** Runs each case through `check()` with the content type from the extractor. Fills `standard_id`, `expected`, and `category` from the checker's output. If the case already has a `standard_id` assigned, the machine checks for violations of that specific standard. If no standard is assigned, the first violation found becomes the primary standard.

**Stage 2: Calibrated annotation.** A separate LLM call receives the case, the checker's verdict and reasoning, and a calibration prompt built from existing human annotations. Fills `human_verdict`, `human_confidence`, and `human_notes`. The calibration prompt uses diversity-maximizing few-shot selection (disagreements first, then greedy by novel standard/content type/verdict).

### Confidence thresholds

Confidence is calibrated against a precedent index built from existing annotations:

- **high**: The exact (standard_id, content_type, verdict) tuple has 3+ precedents in the existing dataset.
- **medium**: Partial precedent (same standard but different content type, or same content type but different standard).
- **low**: No precedent. Default for anything novel or ambiguous.

### Review workflow

Every auto-annotated case gets a `review_status` field:

| Status | Meaning |
|---|---|
| `pending` | Needs human review (default for all auto-annotated cases) |
| `approved` | Human reviewed and accepted the annotation as-is |
| `revised` | Human reviewed and changed the annotation |
| `flagged` | Machine or annotation stage failed; needs manual attention |

Pre-annotated cases (already had `human_verdict`) get `review_status: "approved"`.

### Schema version

The auto-annotator outputs schema version `1.1.0`, which adds `review_status` to each case and `annotation_stats` to the file-level metadata. This is backwards-compatible with `1.0.0` — the eval runner ignores fields it doesn't recognize.

### Usage

```bash
cd ~/Desktop/content-standards-checker/tools

# Annotate an existing extracted file
python auto_annotate.py --input extracted_cases.json --output annotated.json

# Full pipeline: extract from URL + annotate
python auto_annotate.py https://kp.org --domain healthcare \
    --org "Kaiser Permanente" --output ../evals/industry/new_cases.json

# Dry run: see what would be annotated without API calls
python auto_annotate.py --input extracted.json --dry-run

# Custom calibration files
python auto_annotate.py --input extracted.json --output annotated.json \
    --calibration ../evals/industry/healthcare_eval_cases.json \
    --calibration ../evals/industry/fintech_eval_cases.json
```

### Dependencies

Same as the checker (`anthropic` SDK). The extractor's `requests` and `beautifulsoup4` are only needed if running the URL extraction step inline.

### Imports

The auto-annotator imports from the package's public API:

```python
from content_checker import check
from content_checker.standards.loader import load_standards
```

It also imports from its sibling file:

```python
from annotator_prompt import build_calibration_prompt, load_annotated_cases
```

Both tools live in `tools/` and are NOT part of the `content_checker` package. They are standalone utilities that depend on the package being installed (`pip install -e .`).

## Shared LLM interface (api_utils.py, v4.5.1)

Centralizes three concerns that were previously copy-pasted across pipeline.py, validate.py, batch.py, and ui.html.

### JSON parsing

`parse_llm_json(raw, context=)` strips markdown fences and parses JSON. Raises `ParseError` on failure — callers handle the error explicitly, making the failure path visible and auditable. Three stage-specific wrappers enforce expected response shapes:

| Function | Expected shape | On ParseError |
|---|---|---|
| `parse_scan_response()` | `{"violations": [], "passes": []}` | Caller returns error CheckResult |
| `parse_validation_response()` | `{"confirmed": [], "rejected": []}` | Fail-closed: confirm all candidates |
| `parse_consistency_response()` | `{"violations": []}` | Surface to caller, never swallow |

This replaces four different JSON parse behaviors with one contract: **fail-closed, never silent.**

### Client creation with retry

`get_client(api_key=, max_retries=2)` creates a shared Anthropic client with automatic retry on transient errors (429, 500, 502, 503). The client is cached at module level — one instance per process lifetime.

`create_message(system=, user=, model=, max_tokens=)` is the single point of contact with the Anthropic API. All LLM calls (scan, validate, consistency) go through here.

### Constants

`DEFAULT_MODEL` is defined once in api_utils.py. All call sites reference it instead of hardcoding the model string.

### Migration

Each call site replaces its own `import anthropic` + `json.loads` + fence-stripping with:

```python
from content_checker.api_utils import (
    create_message, parse_scan_response, ParseError, DEFAULT_MODEL
)
```

## Standards caching (loader.py, v4.5.1)

`load_standards()` now caches the parsed JSON at module level. The first call reads from disk; subsequent calls return the cached copy. This eliminates N+1 file reads per batch (a 50-string scan was doing 51 reads of the same file).

Cache behavior:
- Default path (no `path=` argument): cached after first read
- Custom path (e.g., test fixtures): always reads from disk, never pollutes cache
- `_reset_cache()`: clears cache for testing
- Process restart: natural cache invalidation

No file-watcher or TTL. The standards library changes only when a developer edits it and restarts the process.

## JS/Python parity status (v4.5.1)

The JavaScript preprocessor in ui.html now has 25 registered checks matching the Python preprocessor. The embedded standards library has 47 standards. Specific parity items resolved:

| Gap | Status |
|---|---|
| GRM-06 compound modifiers | Implemented in JS |
| ACT-01 binary response | Implemented in JS |
| CON-02 safe phrases | Implemented in JS (20 phrases) |
| Classifier "problem"/"issue" | Removed from JS error signals |
| Standards library version | 4.5.1, 47 standards |

**Remaining JS gap (L3):** The plugin's `buildSystemPrompt()` produces a simpler prompt than the Python `build_system_prompt()`. The Python version injects audience context, moment weights, and content type notes. The JS version has none of these. This affects LLM judgment quality in the plugin but not preprocessor coverage.

## Environment

- Python 3.14 (Homebrew on macOS)
- Virtual environment at `.venv/`
- Package installed via `pip install -e .` (requires `setuptools` installed in the venv)
- Tests: `python -m pytest tests/ -v`
- Evals: `python -m evals.run_evals --runs 1`

## Eval discipline

- Library eval is the regression gate. Must stay ≥98%. Run when standards or prompts change.
- Novel eval is the diagnostic. Shows where the checker struggles on unseen copy. Run when the pipeline changes.
- Private industry evals (334 cases in `evals/industry/`) test real-world content. Run when adding content type support or industry packs.
- Don't run 3-pass stability checks unless investigating a specific unstable case. 1-pass is sufficient for regression detection.
- The full evaluation protocol (4-phase: machine annotation → human annotation → quality audit → architectural analysis) is documented in `EVAL_PROTOCOL.md`. Read it before any eval session.

## Patch queue (v4.6.1)

Items resolved this version:

| ID | Description | Status |
|---|---|---|
| H1 | JS/Python parity | Resolved — 25 JS checks, 47 standards |
| H2 | Dead `moment_suppressed_preprocess` variable | Resolved — deleted |
| H3 | `load_standards()` caching | Resolved — module-level cache in loader.py |
| H4 | Shared JSON parse utility | Resolved — api_utils.py |
| M1 | API retry logic | Resolved — `max_retries=2` via api_utils.get_client() |
| M4 | pyproject.toml version alignment | Resolved — bumped to 4.5.1 |
| M5 | `Optional[str]` → `str \| None` in preprocess.py | Resolved |
| P1-wf | compliance_disclosure moment | Resolved (v4.6.0) — moments.py, 64 tests |
| P2-wf | TRN-04 content_type_notes + filter _global fix | Resolved (v4.6.0) — surgical JSON patch + filter fix |
| M2 | Test consolidation (7 files → 1 by standard ID) | Resolved (v4.6.0) — 399 tests in test_preprocess.py |
| P1-rb | VT-02 _global content_type_notes (We/Our framing) | Resolved (v4.6.1) — 7 false positives, cross-domain |
| P2-rb | CLR-01 _global extension (domain-aware jargon) | Resolved (v4.6.1) — 3 false positives, GLP-1/FDIC/401(k) |
| P3-rb | VT-01 heading/short_ui_copy notes (passive trust) | Resolved (v4.6.1) — 2 false positives + heading added to rct |
| P4-rb | CON-02 ui_label audience exemption | Resolved (v4.6.1) — filter.py content-type override |
| P5-rb | PRF-03 browsing_discovery relax weight | Resolved (v4.6.1) — moments.py, rhetorical periods |

Items remaining:

| ID | Description | Priority |
|---|---|---|
| P6-rb | Comma splice / compounding failures (GRM-07?) | Monitor — 1 case, need more data |
| M3 | Shared tools utilities (`tools/shared.py`) | Next session |
| M6 | Dead `get-selection` handler in code.js | Low |
| M7 | Move stale data files from tools/ to evals/ | Low |
| M8 | `tools/venv/` export exclusion | Low |
| L2 | Audience toggle in plugin UI | Future (after manual toggle validated) |
| L3 | JS system prompt parity (audience, moments, notes) | Future |
| L4 | Empty/whitespace input guard on check() | Low |
| L5 | labels.py linear search → dict cache | Low |

## Version history

| Version | Date | Summary |
|---|---|---|
| 4.0.0 | 2026-03 | Initial 5-stage pipeline, 23 preprocessor checks, 46 standards |
| 4.3.1 | 2026-03-26 | Triage CLI, PRF-01 data display, ACT-01 binary response, classifier fix |
| 4.4.1 | 2026-03-28 | Apple eval patches, e-commerce decision patterns |
| 4.4.2 | 2026-03-29 | GRM-05 unicode normalization, celebration + trust moments, 12 moments |
| 4.5.0 | 2026-03-31 | GRM-06 compound modifiers, CON-02 safe phrases, 47 standards, 25 checks |
| 4.5.1 | 2026-04-01 | JS parity complete, api_utils.py, standards caching, ARCHITECTURE.md current |
| 4.6.0 | 2026-04-02 | compliance_disclosure moment (13 moments), heading content type (8 types), Wells Fargo eval (50 cases) |
| 4.6.1 | 2026-04-02 | Robinhood + MEDVi eval patches (P1-P5), corpus → 334 cases across 6 sources, CON-02 nav label fix |
