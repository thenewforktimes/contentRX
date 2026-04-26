# posthog — engine results summary

Generated from `engine_results.jsonl` (10 rows).

## Verdict distribution

- `pass`: 7
- `review_recommended`: 2
- `violation`: 1

## Review reasons (when verdict = review_recommended)

- `situation_ambiguity`: 2

## Severity (across all violations)

- `high`: 3

## Top issue strings

Issues are surfaced verbatim — no `standard_id` mapping per ADR 2026-04-25.

- (1×) Starts with non-descriptive link text.
- (1×) Trailing period on a ui label.
- (1×) Both words are capitalized, making this title case rather than sentence case

## Next step

Skim the high-severity / review_recommended rows by hand. Where the engine got it right, the
standards library worked. Where it got it wrong, capture the case in `notes.md` — those
disagreements feed the refinement log and become the case study's punchline.
