# ContentRX CLI

`contentrx-cli` is a thin command-line client for the [ContentRX](https://contentrx.io)
content-standards checker. It posts your strings to the ContentRX API and
prints violations — the kind of thing you'd call from a pre-commit hook,
a CI job, or an ad-hoc terminal check while writing UI copy.

```
pip install contentrx-cli
export CONTENTRX_API_KEY=cx_...      # mint at https://contentrx.io/dashboard
contentrx "Click here to learn more"
```

The CLI ships with **no third-party dependencies** — stdlib only. Install
time is seconds, the attack surface is whatever Python itself already
includes.

---

## Authentication

All requests need an API key. Generate one in the dashboard:

> https://contentrx.io/dashboard → **Generate key** (or **Rotate**)

The key is shown exactly once. Store it somewhere you trust. The CLI
reads it from the `CONTENTRX_API_KEY` environment variable — no global
config file, no per-directory `.contentrxrc`.

```bash
export CONTENTRX_API_KEY=cx_a1b2c3...
```

If the key is missing or expired the CLI prints a short, actionable
error pointing back at the dashboard URL.

### Pointing at a non-default backend

Self-hosted or test-deployment users can override the API URL:

```bash
export CONTENTRX_API_URL=https://contentrx-staging.example.com
```

---

## Usage

### Single check

```bash
contentrx "Save changes"
```

```
✓ PASS
  Content type: button_cta
  Active-voice verb. Specific action. Clean.
```

With hints:

```bash
contentrx --content-type error_message "Something went wrong."
contentrx --moment destructive_action "Delete forever?"
```

### JSON output

For piping into other tools or inspecting the raw response:

```bash
contentrx --json "Save changes"
```

### Batch check

Text file, one string per line:

```bash
cat > strings.txt <<'EOF'
Save changes
Click here to learn more
Something went wrong.
EOF

contentrx --batch strings.txt
```

JSON with per-string hints:

```bash
cat > strings.json <<'EOF'
[
  {"text": "Save changes", "content_type": "button_cta"},
  {"text": "Delete forever?", "moment": "destructive_action"}
]
EOF

contentrx --batch strings.json
```

### Verbose mode

Adds latency + month-to-date usage from the API response:

```bash
contentrx -v "Save changes"
```

---

## Scenarios

Three concrete things you can do with the CLI today.

### 1. Ad-hoc check while writing copy

You're writing a button label for a hero section. Is "Click here to
learn more" actually good?

```bash
$ contentrx --content-type button_cta "Click here to learn more"
✗ FAIL
  Moment: decision_point
  2 violations:
    ACT-02 [block]  Vague CTA — "Click here" doesn't name the destination.
                    Suggestion: Lead with verb+object: "Learn more" or "Read the docs".
    CLR-03 [warn]   Redundant phrasing — "to learn more" duplicates the button's purpose.

$ contentrx --content-type button_cta "Read the docs"
✓ PASS
  Moment: decision_point
  Verb-first. Object named. Length appropriate for a CTA.
```

Takes <2 seconds per check. Free tier gives 10 checks/month for
exactly this kind of exploration.

### 2. Linting an i18n catalog during CI

You have `locales/en.json` with every user-facing string. Lint it on
every PR that touches it:

```yaml
# .github/workflows/copy-lint.yml
on:
  pull_request:
    paths: ['locales/en.json']

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: pip install contentrx-cli
      - name: Convert en.json → ContentRX batch format
        run: |
          jq -r 'to_entries | map({text: .value}) | tostring' locales/en.json > strings.json
      - name: Lint
        env:
          CONTENTRX_API_KEY: ${{ secrets.CONTENTRX_API_KEY }}
        run: contentrx --batch strings.json
```

Exit code 1 on any violation fails the job and blocks the PR. Engineers
get a terminal output they can scan in 10 seconds.

### 3. Pre-commit hook on a specific file

You only care about the canonical strings file, not every edit. One
hook, scoped to that file:

```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: contentrx
        name: ContentRX
        entry: contentrx --batch
        language: system
        files: ^content/strings\.json$
        pass_filenames: true
```

Runs only when `content/strings.json` changes. Catches violations
before they leave your laptop.

---

## Exit codes

Stable across versions — safe to pin on in CI.

| Code | Meaning |
|------|---------|
| `0`  | All checks passed |
| `1`  | At least one check failed (violations present) |
| `2`  | Usage error (argparse / invalid arguments / bad batch file) |
| `3`  | Missing or invalid `CONTENTRX_API_KEY` |
| `4`  | Monthly quota exhausted |
| `5`  | Rate limit exceeded |
| `6`  | Network / upstream error |

---

## CI examples

### GitHub Actions

```yaml
name: Content lint
on:
  pull_request:
    paths: ['src/**/*.tsx', 'src/**/*.ts']

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: pip install contentrx-cli
      - name: Lint changed UI strings
        env:
          CONTENTRX_API_KEY: ${{ secrets.CONTENTRX_API_KEY }}
        run: |
          contentrx --batch strings.json
```

(For AST-based extraction of strings from TSX/JSX, use the
`contentrx-action` GitHub Action instead of rolling your own
extraction. Shipped separately in `github-action/`.)

### pre-commit

```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: contentrx
        name: ContentRX
        entry: contentrx --batch
        language: system
        files: ^content/strings\.json$
```

---

## Development

```bash
cd cli-client
pip install -e ".[dev]"
pytest tests/
```

Tests mock the HTTP layer so they run offline without an API key.

## License

In-monorepo source: [Functional Source License, FSL-1.1-MIT](../LICENSE) (auto-converts to MIT after the FSL grant period). The published `contentrx-cli` package on PyPI ships under MIT. See [LICENSE](./LICENSE).
