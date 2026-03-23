# Content standards checker — CLI

A command-line tool for checking UX copy against content standards.

## Setup

```bash
pip install anthropic
export ANTHROPIC_API_KEY=sk-ant-...
```

## Usage

### Check a single string

```bash
python checker.py "Click here to learn more"
```

Output:

```
✗ FAIL
  Content type: button_cta
  The link text "Click here to learn more" is not descriptive. It relies on generic phrasing instead of describing the destination.

  Violations (1):
    [ACC-01] Link text uses "click here" which is not descriptive
      → Rewrite to describe the link destination, e.g., "Read our accessibility guidelines"
```

### Interactive mode

```bash
python checker.py --interactive
```

Or simply:

```bash
python checker.py
```

This opens a REPL where you can check multiple strings without restarting.

### JSON output

```bash
python checker.py --json "Save 20% when you upgrade today."
```

Returns the raw JSON response, useful for piping into other tools or CI/CD.

### Options

| Flag | Description |
|------|-------------|
| `--interactive`, `-i` | Enter interactive mode |
| `--json` | Output raw JSON |
| `--type TYPE` | Override auto-detected content type |
| `--verbose`, `-v` | Show latency and token usage |
| `--model MODEL` | Use a different Claude model |

## Content type detection

The CLI auto-detects what kind of content you're checking based on length and keyword signals:

- **button_cta** — short text with action words (save, delete, create, etc.)
- **error_message** — short text with error-related words
- **confirmation** — short text with success-related words
- **tooltip_microcopy** — medium text with a question mark
- **ui_label** — very short text (≤8 words)
- **short_ui_copy** — medium text (≤40 words)
- **long_form_copy** — everything else

You can override this with `--type`:

```bash
python checker.py --type error_message "Something went wrong"
```

## Using as a module

```python
from checker import check_content

result, latency, tokens = check_content("Your payment didn't go through. Try a different card.")
print(result["overall_verdict"])  # "pass"
```
