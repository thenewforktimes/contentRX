# docs-site/content/case-studies

Reference material for the OSS case-study workflow (human-eval build
plan Sessions 26–28). This directory is **not** routed — nothing here
becomes a page on `docs.contentrx.io`. It's the drafting surface:

- `_template.mdx` — the shape every case study should follow. Copy it
  to `docs-site/app/case-studies/<slug>/page.mdx` when publishing.
- `README.md` (this file) — the workflow itself.

The published case studies live under `docs-site/app/case-studies/`
(file-based routing) and are listed in the registry at
`docs-site/lib/case-studies.ts`.

## Workflow

1. **Pick a candidate.** Run `python3 tools/case_study_candidates.py`
   and commit the output at `evals/case_study_candidates.json`. The
   top entries are projects where we have signal (content designer
   acknowledged, active i18n, or a content-design blog) and a
   permissive license. Pick one you can plausibly reach the
   maintainers on.

2. **Contact the maintainers.** Open an issue on their repo or reach
   them through a public channel they advertise. Share the
   motivation — ContentRX is running a case-study series; here's
   what it would look like; would you approve a post if the findings
   are interesting? Get a written yes before any evaluation runs
   against their strings.

3. **Run the tool.** Extract strings from the project (usually a
   component library, error boundaries, onboarding flow). Run
   `contentrx --batch strings.txt --json > run.json`. Keep the raw
   run.json — it's the source of truth for the judgment-call section.

4. **Draft the post.** Copy `_template.mdx` to
   `docs-site/app/case-studies/<slug>/page.mdx`. The template has
   placeholders for three judgment calls (the plan's minimum). Each
   judgment call names the string, the moment, the standard, what
   ContentRX flagged, why a generic linter would miss it, and the
   maintainer's response.

5. **Show the maintainer the draft.** They get the last edit before
   publication. Capture any changes they request.

6. **Add to the registry.** Append a `CaseStudyMeta` entry to
   `CASE_STUDIES` in `docs-site/lib/case-studies.ts`. The entry must
   set:
   - `maintainer_approval: true`
   - `approved_by: "<handle / email / issue #>"`
   - `approved_at: "YYYY-MM-DD"`
   - At least three `judgment_calls`.

   The CI guard at `scripts/check_case_study_approval.py` blocks
   merges on any registry entry missing these.

7. **Open the PR.** Reviewer checks prose + attribution + the
   linked PRs section. Merge.

## Invariants

- **Three judgment calls minimum per study.** Fewer than three and
  the evidence doesn't warrant the post; write it up in a followup
  instead.
- **Maintainer approval is not optional.** No "we couldn't reach
  them in time" exceptions. The success criterion in the plan is
  explicit.
- **Attribution on every quoted string.** License + source URL.
  `/ethics` commitment 2.
- **Opt-out path on every page.** Template's closing section carries
  the boilerplate; keep it.
