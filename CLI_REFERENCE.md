# ContentRX CLI quick reference

All commands assume you're in `~/Desktop/content-standards-checker` with the venv active.

```
cd ~/Desktop/content-standards-checker
source .venv/bin/activate
```

Always use `python3`, not `python` — it's not aliased on this machine.

---

## Tests

```bash
# Run all tests
python3 -m pytest tests/ -v

# Run a specific test file
python3 -m pytest tests/test_preprocess.py -v

# Run a specific test class
python3 -m pytest tests/test_preprocess.py::TestPRF01DoubleSpaces -v

# Run a single test
python3 -m pytest tests/test_preprocess.py::TestPRF01DoubleSpaces::test_double_space_violation -v

# Run tests matching a keyword
python3 -m pytest tests/ -v -k "act01"

# Run tests and stop on first failure
python3 -m pytest tests/ -v -x
```

---

## Evals

```bash
# Library eval (regression gate — must stay ≥98%)
python3 -m evals.run_evals --runs 1

# Novel eval (generalization check)
python3 -m evals.run_evals --novel --runs 1

# Prevent laptop sleep during long eval runs (run in a separate tab)
caffeinate -i
```

---

## Triage

```bash
# Start triage on an export file
python3 tools/triage.py triage/opendoor_2026-03-29.json

# Resume triage (skip already-reviewed cases)
python3 tools/triage.py triage/opendoor_2026-03-29.json --unreviewed

# Jump to a specific case
python3 tools/triage.py triage/opendoor_2026-03-29.json --jump SCAN-2026-03-29-042

# View the summary dashboard without entering review mode
python3 tools/triage.py triage/opendoor_2026-03-29.json --summary
```

Triage keyboard shortcuts during review:
- `y` agree with machine
- `n` override verdict
- `s` skip case
- `b` go back
- `d` show dashboard
- `q` save and quit
- `r` log a taxonomy refinement

---

## Auto-annotator

```bash
# Annotate an existing extracted file
python3 tools/auto_annotate.py --input extracted_cases.json --output annotated.json

# Full pipeline: extract from URL + annotate
python3 tools/auto_annotate.py https://kp.org --domain healthcare \
    --org "Kaiser Permanente" --output evals/industry/new_cases.json

# Dry run (no API calls)
python3 tools/auto_annotate.py --input extracted.json --dry-run
```

---

## Package management

```bash
# Reinstall the package after changing source files
pip install -e .

# If pip install -e fails on Python 3.14
pip install setuptools
pip install -e .

# Install a new dependency
pip install <package> --break-system-packages
```

---

## Figma plugin

The plugin lives in `figma-plugin/` with three files: `manifest.json`, `code.js`, `ui.html`.

To load the plugin in Figma:
1. Open any Figma file in the desktop app
2. Menu → Plugins → Development → Import plugin from manifest
3. Point to `figma-plugin/manifest.json`

To reload after editing plugin files:
- Menu → Plugins → Development → your plugin name (it hot-reloads the UI on reopen)

Triage export files from the plugin land in `triage/` — named by scan date.

---

## Checking a single string from the terminal

```bash
# Using the package directly
python3 -m content_checker "Your text to check here"

# With a specific content type
python3 -c "
from content_checker import check
result, lat, tok = check('Your text here', content_type='error_message', use_llm_classifier=False)
print(result.to_dict())
"
```

---

## Preprocessor-only check (no API cost)

```bash
python3 -c "
from content_checker.preprocess import preprocess
results = preprocess('Click here to learn more', 'short_ui_copy')
for r in results:
    if r.is_violation:
        print(f'{r.standard_id}: {r.issue}')
"
```

---

## Inspecting triage/eval JSON files

```bash
# Pretty-print a JSON file
python3 -m json.tool triage/opendoor_2026-03-29.json | head -50

# Count cases in a triage file
python3 -c "import json; d=json.load(open('triage/opendoor_2026-03-29.json')); print(len(d['cases']), 'cases')"

# Count reviewed vs unreviewed
python3 -c "
import json
d = json.load(open('triage/opendoor_2026-03-29.json'))
reviewed = sum(1 for c in d['cases'] if c.get('human_verdict'))
total = len(d['cases'])
print(f'{reviewed}/{total} reviewed, {total - reviewed} remaining')
"

# List all triage categories and their counts
python3 -c "
import json
from collections import Counter
d = json.load(open('triage/opendoor_2026-03-29.json'))
cats = Counter(c.get('triage_category', 'unreviewed') for c in d['cases'])
for cat, n in cats.most_common():
    print(f'{cat}: {n}')
"
```

---

## File locations

```
src/content_checker/          # The package — all source code
src/content_checker/audience.py  # Audience signal module (new in v4.4.0)
src/content_checker/standards/standards_library.json  # 46 standards
tests/                        # All test files
evals/                        # Eval runner + eval cases
evals/industry/               # Human-annotated real-world cases
tools/triage.py               # Triage CLI
tools/auto_annotate.py        # Auto-annotator
tools/extract_content.py      # HTML content extractor
figma-plugin/                 # Plugin files (manifest, code.js, ui.html)
triage/                       # Triage export files from the plugin
ARCHITECTURE.md               # Read this first every session
taxonomy_refinement_log.md    # Granularity gaps from triage
```
