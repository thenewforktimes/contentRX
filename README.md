# ContentRX

The content model for product copy. Situation-aware review for the moments where copy stops being decoration and starts being the product — error states, destructive confirmations, permissions flows, empty states. A staff content designer's pattern recognition, running where product copy is increasingly written: Claude Code, Cursor, your CLI, and every pull request.

This repository is **source-available** under the [Functional Source License](LICENSE) (FSL-1.1-MIT). You can read it, fork it, audit it, contribute to it, and use it internally. You can't ship a commercial replica. After two years from each release, the code converts to MIT.

## Transparent about how, private about what

You can audit how we handle your text — every line that touches a customer string is open. You can audit our decisions, our security model, and our published accuracy. The editorial judgment is proprietary, the way an editor's judgment at any serious publication is proprietary. What you're paying for is access to that judgment, calibrated weekly. This isn't a software tool you could build yourself.

The split, concretely:

- **Open**: the engine pipeline. The three data-handling guard files ([pii-screen](src/lib/pii-screen.ts), [sentry-scrub](src/lib/sentry-scrub.ts), [safe-error-log](src/lib/safe-error-log.ts)). The security architecture. The [decisions/](decisions/) record. Every test across every surface. The customer-not-product [contract](decisions/2026-04-28-customer-not-product.md).
- **Private**: the editorial library. The specific standards and moments the engine evaluates against. The override stream, the refinement log, and the calibration internals. These live in a separate substrate that the engine loads at runtime.
- **Public accountability for the private part**: `/accuracy` reports measured kappa with 95% CI. `/calibration` is the weekly calibration log. `/essays` and `/reports` carry the named-expert narrative and quarterly reports.

The work is in maintaining the editorial judgment, not in the static rules. A published rulebook is stale within a quarter. What you verify is the integrity of the process — measured accuracy, weekly calibration, public decisions — not the contents of a snapshot.

## What it does

Paste a piece of UI copy — a button label, error message, tooltip, onboarding flow — and the checker evaluates it against a private library of content standards covering clarity, voice and tone, consistency, accessibility, action-oriented writing, content structure, grammar and mechanics, inclusive language, and translation readiness.

You get a pass/fail verdict, the specific standards violated, and a suggestion for each. You decide what to fix and how — the tool flags problems, it doesn't rewrite your copy.

## Setup

Requires Python 3.10+ and an Anthropic API key.

```bash
# Install the package
pip install -e ".[dev]"

# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...
```

## Usage

### Check a single string

```bash
content-checker "Click here to learn more"
```

### Interactive mode

```bash
content-checker --interactive
```

### Batch mode

Check multiple strings at once. Catches individual violations and cross-snippet consistency issues (terminology switching, inconsistent action verbs).

```bash
# Plain text file, one string per line
content-checker --batch strings.txt

# JSON with metadata
content-checker --batch flow.json --verbose
```

A batch JSON file can be a simple array of strings or an array of objects with metadata:

```json
[
  {"text": "Go to Settings", "label": "Nav link"},
  {"text": "Open the Preferences panel", "label": "Help text"},
  {"text": "Update your Alerts", "label": "Section heading"}
]
```

### Options

| Flag | Description |
|---|---|
| `--interactive`, `-i` | Enter interactive mode |
| `--batch FILE` | Check multiple strings from a .txt or .json file |
| `--json` | Output raw JSON |
| `--type TYPE` | Override auto-detected content type |
| `--verbose`, `-v` | Show pipeline details, latency, and token usage |
| `--model MODEL` | Use a different Claude model |
| `--heuristic` | Use heuristic classifier instead of LLM (faster, less accurate) |
| `--unfiltered` | Skip filtering and validation (uses all standards) |

### As a Python library

```python
from content_checker import check, check_batch
from content_checker.models import ContentItem

# Single string
result, latency, tokens = check("Your payment didn't go through. Try a different card.")
print(result.overall_verdict)  # "pass"

# Batch with consistency checking
items = [
    ContentItem("Go to Settings", label="Nav link"),
    ContentItem("Open the Preferences panel", label="Help text"),
]
batch = check_batch(items)
print(batch.overall_verdict)           # "fail"
print(batch.consistency_violations)    # cross-snippet terminology inconsistency
```

## How it works

The checker runs a 5-stage pipeline:

1. **Classify** — an LLM call identifies the content type (button, error message, confirmation, tooltip, label, short UI copy, or long-form copy). Falls back to a heuristic when no API key is available.
2. **Filter** — the standards library is pruned to only the rules relevant to that content type. A button gets a much narrower set than long-form copy. This reduces false positives and API costs.
3. **Scan** — two parallel tracks: a deterministic pre-processor catches mechanical violations at zero cost, while an LLM call checks the nuanced rules against the filtered set.
4. **Validate** — a second LLM call reviews each candidate violation and confirms or rejects it with full context, including content-type-specific notes (e.g., passive voice is acceptable in confirmations).
5. **Merge** — deterministic and LLM results are combined, deduplicated, and a final verdict is produced.

For batch mode, each item runs through the pipeline individually, then a consistency pass checks for cross-snippet inconsistencies across the full set.

## Project structure

```
src/content_checker/       # Core library (pip installable)
  pipeline.py              # Single-string pipeline orchestrator
  batch.py                 # Batch handler + consistency checker
  classify.py              # Content type classifier (LLM + heuristic)
  filter.py                # Standards filter by content type
  preprocess.py            # Deterministic mechanical checks
  validate.py              # Validation pass with content-type notes
  models.py                # Typed data contracts (Violation, CheckResult, etc.)
  standards/
    loader.py              # Standards library path resolution
cli/
  main.py                  # CLI entry point (single, interactive, batch modes)
figma-plugin/              # Figma plugin (see figma-plugin/README.md)
tests/                     # Engine test suite
```

## Standards library

The standards library is private. Per the [private-taxonomy ADR](decisions/2026-04-25-private-taxonomy-pivot.md),
the per-standard rules and rationale are internal artifacts. The
public-facing surfaces — `/accuracy`, the weekly calibration log, and
the quarterly reports — describe what the library evaluates without
enumerating it. See those surfaces for measured accuracy and drift
data; the rules themselves do not ship.

## Accuracy

Measured system kappa, self-drift kappa with 95% CI, and a target
ceiling are reported on `/accuracy`. The weekly calibration log on
`/calibration` tracks kappa movement, drift signals, override count,
and refinement-log activity. See those pages for the live numbers
rather than this README.

## Contributing

See `CONTRIBUTING.md` for guidelines.

## License

See `LICENSE` for details.
