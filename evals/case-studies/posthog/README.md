# Case study: posthog

Working directory for the posthog case study.

## Source

- **Repo:** `https://github.com/PostHog/posthog`
- **Last crawled HEAD:** `c98f83528b3b366a9cfcc46dc901fa6e7d226b9d`
- **Path filters:**
  - `frontend/src/scenes/**/*.tsx`
  - `frontend/src/scenes/**/*.jsx`
- **Strings extracted (deduped):** 3730

## Files in this folder

- `extracted_strings.jsonl` — raw strings pulled by the regex extractor.
  One JSON record per line: `{text, kind, source_file, line, target, head_sha}`.
  Source files are repo-relative.
- `engine_results.jsonl` — engine verdicts keyed by the same text. Written
  by `case_study.py evaluate`.
- `summary.md` — narrative roll-up. Hand-written with help from
  `case_study.py summarize`.
- `notes.md` — running observations as the human reads through results.
- `.gitignore` — excludes the cloned source tree from git.

## Workflow

1. **Crawl** (this step ran already):
   ```bash
   python3 tools/case_study.py crawl --slug posthog \
       --repo https://github.com/PostHog/posthog \
       --paths "frontend/src/scenes/**/*.tsx"
   ```
2. **Evaluate** — send strings through the engine. Free-tier API
   account = 25 scans/month, so cap with `--limit`:
   ```bash
   python3 tools/case_study.py evaluate --slug posthog --via api \
       --api-key "$CONTENTRX_API_KEY" --limit 25
   ```
   Or skip the API quota and call the local engine directly (still
   pays Anthropic credit, but no /api/check counter):
   ```bash
   python3 tools/case_study.py evaluate --slug posthog --via engine --limit 25
   ```
3. **Summarize**:
   ```bash
   python3 tools/case_study.py summarize --slug posthog
   ```

## What this study is NOT

- It is not yet the published case study. Until a maintainer of the
  target signs off, the `docs-site/content/case-studies/posthog/page.mdx`
  artifact stays unwritten. The CI guard in
  `docs-site/lib/case-studies.ts` blocks merges without
  `maintainer_approval: true`.
- It is not a definitive judgment of the target's content quality.
  The engine reports its read; the human's notes record where the
  read was wrong. Disagreement is the point.
