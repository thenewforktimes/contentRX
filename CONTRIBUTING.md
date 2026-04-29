# Contributing

Thanks for your interest in contributing. Here's how to get involved.

## What's public, what's private

The engine code, the data-handling guard files, the security architecture,
the decisions, and the tests are all open. The editorial library — the
specific standards and moments the engine evaluates against — is private,
loaded from a separate gitignored substrate at runtime. See
[decisions/2026-04-25-private-taxonomy-pivot.md](decisions/2026-04-25-private-taxonomy-pivot.md)
for the rationale.

This means external contributions to the engineering surfaces are welcome
and reviewable in the open. Contributions that would change the editorial
library itself (adding a new standard, tweaking a rule) cannot land
through public PRs — that work happens in the private substrate. Open an
issue to start that conversation.

## Setup

```bash
# Clone and install in development mode
git clone https://github.com/thenewforktimes/contentRX.git
cd contentRX
pip install -e ".[dev]"

# Set your API key (needed for evals, not for unit tests)
export ANTHROPIC_API_KEY=sk-ant-...

# Run the test suite
pytest
```

The engine reads its substrate from `src/content_checker/standards/private/`,
which is gitignored. Public contributors get a project that imports cleanly
and runs the suite for any tests that don't require the substrate; tests
that do need it skip with a clear message. If you're working on the engine
internals and need the live substrate, ask the maintainers.

## Ways to contribute

**Engine code.** The pipeline, classifier, filter, preprocessor, validator,
and merge logic in `src/content_checker/` — all open for fixes and
improvements. The deterministic preprocessor (`preprocess.py`) is the place
to land mechanical-rule fixes that the LLM consistently misses.

**Surface code.** The CLI, MCP server, LSP server, GitHub Action, Figma
plugin, and web app all live in this repo and welcome fixes / UX
improvements. Each has its own README and CLAUDE.md with surface-specific
conventions.

**Customer-data handling.** The three guard files
([src/lib/pii-screen.ts](src/lib/pii-screen.ts),
[src/lib/sentry-scrub.ts](src/lib/sentry-scrub.ts),
[src/lib/safe-error-log.ts](src/lib/safe-error-log.ts)) are open for
review and tightening. If you find a category of leak the screen misses
or a Sentry path that bypasses the scrub, that's a high-value PR.

**Tests.** Engine, web app, MCP, CLI, LSP, GitHub Action — every surface
has its own test suite. Adding regression coverage (especially around the
schema 2.0.0 wire format and the substrate-stripping snapshot tests) is
always welcome.

**Documentation.** If setup was confusing, the README was unclear, or you
had to figure something out that should have been documented — that's a
contribution.

## How to submit changes

1. Fork the repo
2. Create a branch (`git checkout -b your-branch-name`)
3. Make your changes
4. Run `pytest` — all tests must pass
5. If you changed the standards library, run the eval suite to verify accuracy
6. Open a pull request with a clear description of what you changed and why

## Project structure

```
src/content_checker/       # Core library — what gets imported
  pipeline.py              # check() and check_unfiltered()
  batch.py                 # check_batch() and consistency checking
  classify.py              # Content type classification
  filter.py                # Standards filtering by content type
  preprocess.py            # Deterministic pre-processing
  validate.py              # Validation pass
  models.py                # Typed data contracts
  standards/               # Standards library and loader
cli/                       # CLI entry point — not imported by the library
tests/                     # pytest suite — run with: pytest
evals/                     # Eval runner and test cases — costs API tokens
```

The library (`src/content_checker/`) should never import from `cli/` or `evals/`. The CLI and eval runner import from the library.

## Code style

- Python 3.10+ with type hints on all public functions
- Use dataclasses from `models.py` instead of raw dicts for function inputs and outputs
- `anthropic` is imported lazily inside functions that make API calls, so the library is importable without an API key
- No inline tests — all tests go in `tests/` using pytest
- Commit messages: use imperative mood ("Add standard for emoji usage" not "Added standard")
- JavaScript: the Figma plugin is vanilla JS with no build step — keep it that way

## Running evals

Evals cost API tokens. Run them only when something changes:

- Standards added or revised → run library eval (`python -m evals.run_evals --runs 1`)
- Pipeline code changed → run both suites
- Model version upgraded → run both suites
- Users report false positives/negatives → investigate with `--category` runs

Library eval is the gate (must stay at 100%). Novel eval is the diagnostic (tells you where to investigate, target is 90%+).

## Questions?

Open an issue. There's no question too small.
