# Parity corpus

The corpus that the JS/Python preprocessor parity gate runs against.

## Why this exists

Two preprocessors implement the same deterministic content rules:
- **Python**: `src/content_checker/preprocess.py` — runs in `/api/check`
  and the CLI
- **JavaScript**: the `runPreprocessor()` block inside
  `figma-plugin/ui.html` — runs entirely client-side in the Figma plugin

When they drift, a customer running the plugin on a string and then the
CLI on the same string gets different verdicts. That undermines the
"write once, enforce everywhere" promise. v2 Session 2 (per
`BUILD_PLAN_v2.md`) made divergence impossible to ship: every PR runs
`tools/parity_check.py` which exercises both runtimes against this
corpus and fails CI on any divergence.

## What's in the corpus

`parity_corpus.json` is the union of two sources:

1. **All cases from `evals/novel_cases.json`** (currently 41) — the
   project's existing novel-test suite. Most cases target LLM-judged
   rules (CLR, VT, ACT, STR, TRN), so for each the preprocessor
   produces no violations on either side; the parity assertion is
   "both runtimes correctly defer to the LLM."

2. **Hand-picked preprocessor-targeted cases** (currently 12) covering
   deterministic rules that `novel_cases.json` under-represents — the
   `GRM-06` v4.5.0 patch, the `CON-02` safe-phrase allowlist, and a
   few `PRF-*` / `INC-*` / `ACC-01` checks where parity drift would
   silently break the plugin. Each case is a one-liner with an
   obvious expected outcome.

Total: **53 cases** as of this commit.

## Selection criteria for additions

When adding a case, ask:

- **Does it exercise a deterministic preprocessor check?** If the
  expected verdict comes from the LLM, the case is not useful here
  (use `evals/` instead). If both runtimes will defer to the LLM,
  it's still useful as a "both-defer" parity assertion — but prefer
  cases that one or both preprocessors actually fire on.
- **Is it short and unambiguous?** The corpus is a regression detector,
  not an eval suite. One-line cases are easier to debug when CI breaks.
- **Does it cover a rule we haven't covered yet?** Look at `case_id`
  values to see which standards are represented.

## Adding a case

Append to the `cases` array in `parity_corpus.json` with this shape:

```json
{
  "case_id": "PARITY GRM-XX descriptive name",
  "standard_id": "GRM-XX",
  "input": "the text to evaluate",
  "content_type": "short_ui_copy",
  "expected": "fail",
  "category": "Grammar",
  "note": "Why this case matters for parity."
}
```

Then re-run `python3 tools/parity_check.py` — exit 0 means the new
case agrees across runtimes, exit 1 means there's a divergence to fix.

## Running locally

```bash
# Full run, summary only
python3 tools/parity_check.py

# Verbose: print every case's result
python3 tools/parity_check.py --verbose

# Run against a different corpus file (useful for ad-hoc spot checks)
python3 tools/parity_check.py --corpus path/to/other.json
```

The CI gate at `.github/workflows/parity.yml` runs the same command on
every PR and every push to `main`.

## When CI fails

If the parity gate goes red, one of the two preprocessors changed
without the other. To fix:

1. Look at the diff in the failing CI log — it lists every divergent
   case with `violations only in Python` / `violations only in JS` /
   `suppressed only in …`.
2. Decide which side is correct. Usually it's the one that just
   shipped a new check (Python is canonical for new rules; JS catches
   up via a corresponding edit to `runPreprocessor()` and friends in
   `figma-plugin/ui.html`).
3. Patch the lagging side, re-run `python3 tools/parity_check.py`,
   confirm full agreement, push.

If both sides are wrong (e.g., the corpus case has an outdated
expectation), edit the case in `parity_corpus.json` and re-run.

## Long-term plan (v2 Phase 6+)

The right architectural endgame is one source of truth — either a JSON
DSL both runtimes interpret, or compiling the Python preprocessor to
WASM via Pyodide. That's logged as a P2 follow-up; for now this CI
gate is the pragmatic guard.
