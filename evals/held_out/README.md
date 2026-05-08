# Held-out golden set

Human-eval build plan Session 5. A ~100-case reference list carved from
the annotated industry corpus at `evals/industry/`. The manifest does
**not** duplicate raw case text — it stores `case_id` + selection
metadata. The runner looks each case up in its source file at eval time.

**2026-05-06 update.** The previously committed `manifest.json` was
deleted in the product-extraction cleanup (ADR
[`2026-05-06-product-extraction-deletion.md`](../../decisions/2026-05-06-product-extraction-deletion.md))
because every entry's `case_id` and `source_file` named third-party
brands extracted from public-facing experiences. The manifest itself
was metadata only — the underlying scraped content already lived in
the gitignored `evals/industry/` directory — but the public record of
brand-name eval sourcing was its own exposure surface. Regenerate
locally from license-compatible cases when the corpus is reseeded; no
committed manifest until then.

## What it's for

Two jobs:

1. **Blocking CI gate.** The held-out run (Session 6) executes these
   cases against the current engine and computes Cohen's κ against the
   stored `human_verdict`. Any disagreement fails the build unless the
   change is approved with a `held-out-update:` commit prefix.
2. **`/accuracy` page denominator.** The public accuracy page (Session 24)
   reports κ with 95% CI over this fixed pool so the number is
   reproducible and not cherry-picked.

Never both eval gates on the same corpus. The library regression gate
(`evals/novel_cases.json`) is adversarial synthetic data testing *rules*;
the held-out gate is production-like data testing *the engine*. They
catch different kinds of break.

## Selection criteria

Written in `tools/select_held_out.py`. The full selection is
deterministic — same eligible pool + same args always produce the same
manifest. Tool re-runs after the corpus grows pick up new cases without
churning the existing ones (stable ordering by `source_file, case_id`).

**Eligibility filter:**
- `human_confidence == "high"`
- `review_status in {"approved", "revised"}`

**Coverage passes (in order):**

1. **Moment coverage.** Every moment with ≥5 eligible cases gets ≥5
   held-out slots. Moments with <5 eligible cases are skipped for
   coverage but remain eligible for the later passes.
2. **Standard coverage.** Every standard with ≥3 eligible cases gets ≥3
   held-out slots. (This approximates the plan's "every standard that
   reaches 80%+ graduation readiness" — graduation readiness doesn't
   exist until Session 10. We revisit once that lands.)
3. **Source proportionality.** Remaining slots are filled proportional
   to each source file's share of the eligible pool, using largest-
   remainder allocation so the target lands exactly.
4. **Fill remainder.** Any residual gap (when a source's quota exceeded
   its leftover eligible cases) is filled from any remaining eligible
   cases in deterministic `(source_file, case_id)` order.

**Case_id synthesis.** About one-third of eligible cases in the current
corpus ship with `case_id: null` (Wells Fargo, Robinhood, MEDVi). The
loader synthesizes a stable `auto:<source_file>:<1-based-index>` for
these so they can be referenced. Once the corpus grows real `case_id`
values, the synthetic references will resolve to the same cases by
position — but long-term the corpus should carry real IDs so files
can be re-ordered without manifest churn.

## Retirement rules

The manifest grows bounded, not unbounded. Target steady-state is 150
items; once the pool exceeds that, retire the 10 oldest low-signal
items before adding new.

- **Standard retirement.** When a standard retires, its held-out items
  stay in the manifest but are archive-flagged — they stop gating
  releases, they stay queryable for historical comparison.
- **Taxonomy split approval.** When a refinement-log entry splits a
  standard or content type, add one item from each side of the split
  to the held-out manifest.
- **Case retirement.** A case retires when its source file retires,
  when its verdict is formally superseded, or when a sample audit
  finds the verdict no longer reflects current best practice.

## Current coverage gaps

The current eligible pool (high-confidence + approved/revised across
`evals/industry/`) has 363 cases but does not cover every moment. As
of 2026-04-23:

- `compliance_disclosure`, `destructive_action`, `confirmation`,
  `empty_state`, `interruption` — **zero eligible cases.**
  Held-out can't represent these until annotation lands.
- `error_recovery`, `compliance_disclosure` — under-represented in the
  annotated pool.

The held-out selection skips coverage for moments with <5 eligible
cases rather than artificially lowering the threshold. When more
annotation lands, `python3 tools/select_held_out.py` re-runs and the
new manifest picks up the newly-covered moments automatically.

## How to re-run

From a checkout that has the private corpus:

```
python3 tools/select_held_out.py
```

From anywhere else (e.g. a git worktree without the private data):

```
python3 tools/select_held_out.py --corpus-dir /path/to/evals/industry
```

The manifest is regenerated in place. Commit the diff alongside the
corpus change that motivated it. The tool prints a before/after stats
summary so the churn is reviewable.

## How the gate runs

See `tools/run_held_out.py`. The runner reads the manifest, looks each
case up by `(source_file, case_id)` in the gitignored source files,
executes the pipeline, and compares verdicts. When the source files
aren't present (e.g., in CI without the private corpus), the runner
degrades gracefully — it reports "data unavailable" instead of
crashing, so the gate is only green when actual comparison ran.

## What `schema_version` means

The manifest's `schema_version` is independent of the API envelope
version (`src/lib/api-envelope.ts`). It tracks the shape of the
manifest file itself — entries schema, selection_spec fields, stats
keys. Bump the manifest schema when those change; the API envelope
doesn't need to care.
