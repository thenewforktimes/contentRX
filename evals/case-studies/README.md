# Case studies

Working area for OSS product case studies — the named-expert moat
artifacts per [ADR 2026-04-25](../../decisions/2026-04-25-private-taxonomy-pivot.md).

Each case study runs ContentRX against a real product, records where
the engine agrees with hand-judgment and where it doesn't, and (once
the target's maintainers sign off) graduates to a published narrative
at `docs-site/content/case-studies/<slug>/page.mdx`.

## Why

The moat is operational, not architectural. What compounds it is
public evidence of work — measured accuracy, specific findings on
named products, the founder's voice across the cadence. Publishing
narrative is the highest-leverage activity post-launch.

The infrastructure for the published artifact already exists:

- Typed registry at `docs-site/lib/case-studies.ts`
- MDX template at `docs-site/content/case-studies/_template.mdx`
- CI guard blocks merges without `maintainer_approval: true`,
  `approved_by`, `approved_at`, and ≥3 documented `judgment_calls`
- Candidate shortlist at `evals/case_study_candidates.json`

What was missing: the **research workflow** that produces the
artifact. This directory is that workflow.

## Per-target layout

```
evals/case-studies/
  <slug>/
    README.md                 # scope, source, current state
    extracted_strings.jsonl   # one record per UI string from the target
    engine_results.jsonl      # public envelope per string (after evaluate)
    summary.md                # auto-rolled stats from summarize
    notes.md                  # human-written observations and disagreements
    .gitignore                # excludes the cloned source tree
```

`extracted_strings.jsonl` and `engine_results.jsonl` are committed for
reproducibility. The cloned source tree under
`/tmp/contentrx-case-studies/<slug>/` is **not** committed; re-clone
from the recorded `head_sha` if you need it.

## Workflow

Driven by `tools/case_study.py`. Three subcommands: `crawl`,
`evaluate`, `summarize`. See the tool's `--help` for details.

```bash
# 1. Crawl — clones the target shallow, runs the regex extractor over
#    files matching the path filters, writes extracted_strings.jsonl
python3 tools/case_study.py crawl \
    --slug posthog \
    --repo https://github.com/PostHog/posthog \
    --paths "frontend/src/scenes/**/*.{tsx,jsx}"

# 2. Evaluate — sends each string through /api/check (counts quota)
#    or the local engine (no quota; pays Anthropic directly)
python3 tools/case_study.py evaluate \
    --slug posthog \
    --via api \
    --api-key "$CONTENTRX_API_KEY" \
    --limit 25

# 3. Summarize — rolls up verdict counts, review-reason histogram,
#    severity distribution, top issue strings into summary.md
python3 tools/case_study.py summarize --slug posthog
```

## Quota math

Free-tier `/api/check` is 25 scans/month. PostHog has hundreds of
unique strings even after deduping; one full crawl through `/api/check`
won't fit. Two ways to scale:

- **`--via engine`** bypasses /api/check (no DB write, no quota
  decrement). Still pays Anthropic credit for each LLM call. The
  engine's `to_public_envelope()` is identical to /api/check's
  output, so the artifact shape is the same either way.
- **Pro plan** = 5,000 scans/month. Enough for several full crawls.

For first iteration on a new target, the workflow above with
`--limit 25` gets a representative sample without burning anyone's
budget.

## Boundaries

- **Don't publish without maintainer approval.** Until the target's
  team has reviewed the findings and signed off, the artifact stays
  in this directory. The CI guard at `docs-site/lib/case-studies.ts`
  enforces that.
- **Engine reads are not verdicts on the target.** The engine reports
  what it sees through the standards library; where it's wrong, the
  human's `notes.md` records why. Disagreement is the point — both
  for the case study's narrative and for the refinement log.
- **No PII or proprietary content.** The targets in scope are OSS
  products with public repos. If a target has gated content (admin
  panels, pricing pages with personalization), the crawl should
  exclude those paths.
