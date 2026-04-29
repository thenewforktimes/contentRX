# External signal pipeline

Human-eval build plan Session 15. Extracts `(old_string, new_string)`
copy-change pairs from the curated OSS allow-list as external training
signal. **Strictly separated from production evaluations** — mined
pairs live here, in JSON, never joined with `violations` /
`violation_overrides` / `graduation_status` tables without an explicit,
logged review step.

## Ethical framing

The framework lives at [/ethics](https://contentrx.io/ethics) — five
commitments: transparency, attribution, respect, license-awareness, PII
avoidance. This pipeline is the concrete code behind three of them
(respect + license-awareness + attribution). If you're here to review
how the miner behaves, that page is the canonical contract.

## Workflow

```
1. Configure access
     export GITHUB_TOKEN=<personal_access_token>
     # Scopes: public_repo (read-only) + read:org if private-access needed

2. Run the crawler
     python3 external_signal/github_miner.py
     # Or one repo:
     python3 external_signal/github_miner.py --repo vercel/next.js

3. Review the output
     ls external_signal/output/
     # JSON per repo: <owner>__<name>.json
     # Gitignored — never committed

4. (future) Ingest into DB after Robert's review
     # Not wired today. The JSON output is the reviewer's workbench
     # until an ingest path lands in a later session.
```

## What gets mined

Every run filters through a cascade:

1. **Allow-list** — only repos in `allow_list.json` are considered.
2. **File-type** — `.jsx`, `.tsx`, `.vue`, `.svelte`, `.mdx`, `.po`,
   `.xlf`, translation `.json` files, markdown under `/docs` or
   `/content`.
3. **Commit message** — soft-tagged as copy work. Matches substrings
   like `"fix typo"`, `"clarify"`, `"improve error message"`,
   `"soften tone"`, `"rewrite for clarity"` (full list in the code).
4. **Diff pattern** — pairs are extracted only from changed lines
   inside quoted strings. Pure hex / URL / version-bump pairs are
   rejected as noise. False positives are expected and acceptable;
   Robert's review distinguishes the signal from the noise.

## Allow-list management

Edit [`allow_list.json`](./allow_list.json) directly. Each entry:

```json
{
  "owner": "vercel",
  "name": "next.js",
  "license": "MIT",
  "content_paths": ["docs", "errors"],
  "reason": "Why this repo deserves a slot"
}
```

Per the plan spec, **expand slowly**: each new repo gets a week of
sampling before wider inclusion. Add the repo, run for a week, review
the output, decide to keep it.

## Rate-limit discipline

- **User-agent** identifies us: `contentrx-research-bot (ethics: https://contentrx.io/ethics)`.
- **Sequential requests** — no concurrency. Ever.
- **1-second delay** between per-commit REST fetches.
- **Exponential backoff** on 429 / 403 up to 3 retries.
- **File cache** at `external_signal/cache/` stores GraphQL + REST
  responses. Re-runs are mostly cache hits; only new commits trigger
  network.

## Output shape

Per-repo JSON, append-only across runs:

```jsonc
{
  "repo": "vercel/next.js",
  "license": "MIT",
  "schema_version": "1.0.0",
  "last_crawl_at": "2026-04-23T…Z",
  "total_commits": 42,
  "commits": [
    {
      "sha": "abc123…",
      "message": "fix typo in error message\n\nLonger body…",
      "committed_at": "2026-04-20T12:34:56Z",
      "license": "MIT",
      "pairs": [
        {
          "file_path": "packages/next/src/server/api-utils/index.ts",
          "old_string": "An error occurred while processing",
          "new_string": "Something went wrong. Try again."
        }
      ]
    }
  ]
}
```

## Opt-out

Per [`/ethics`](https://contentrx.io/ethics), projects can opt out
via:

```
email: hello@contentrx.io
subject: [OPTOUT] <source name>
```

Opt-out handling:
1. Remove the repo from `allow_list.json`.
2. Delete the corresponding output file from `external_signal/output/`.
3. Best-effort remove any derived signal in the next release cycle.

## Intent tagging + repo quality (Session 18)

Each mined commit gets an `intent` category attached to its record:

| Category | Match signal | Suggested triage_category |
|---|---|---|
| `typo_fix` | "typo", "spelling", "grammar", "punctuation" | `correct` |
| `i18n_motivated` | `i18n:`/`l10n:` prefix or translator/locale mention | TRN-* family |
| `tone_shift` | "tone", "voice", "soften", "friendlier", "approachable" | `missing_standard` |
| `clarification` | "clarify", "simplify", "reword", "disambiguate" | `missing_standard` |
| `restructure` | "rewrite", "reorganize", "consolidate" | `context_gap` |
| `unknown` | nothing matched | (no prior) |

Priority: i18n wins over typo wins over tone wins over clarification
wins over restructure. The mapping is documented, **not enforced** —
Robert reviews actual triage_category at review time.

Each repo gets a `quality_score` (0..3) summed from three signals on
the allow-list entry:

- `has_content_designer` — acknowledged in CONTRIBUTORS / docs
- `active_i18n` — `locales/` or `translations/` directory, active
- `content_design_blog` — team writes about content publicly

Higher-quality repos get earlier position in the review queue; lower
scores don't block — they just sort later. Set signals manually in
`allow_list.json`; auto-detection is a follow-up.

## What Session 15 does NOT do

- **No DB ingest.** The spec calls for a separate `external_signal`
  database namespace. The JSON output IS the namespace today. A
  future session wires a TS-side ingest when Robert's review workflow
  for external signal is defined.
- **No classifier routing.** The plan describes pushing mined pairs
  through ContentRX's classifier and surfacing disagreement cases in
  Robert's review. That routing is a follow-up — the miner does step 1
  (extract); step 2 (classify + queue) lands separately.
- **No intent tagging.** Session 18's job. The soft-tag list in
  `COMMIT_SOFT_TAGS` is a coarse filter, not the intent classifier.
- **No automatic cron.** Run manually; week-by-week cadence is
  intentional while the pipeline matures. A nightly cron can land
  once the output volume settles.

## Testing

```sh
python3 -m pytest tests/test_github_miner.py -v
```

Tests mock the GitHub API entirely — no network access during the
suite. They cover the filter cascade (file-type + commit-message +
diff-pattern), pair extraction, and rate-limit retry handling.
