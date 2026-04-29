# ContentRX GitHub Action

Lint the UI copy in your pull requests against the
[ContentRX](https://contentrx.io) content-design standards.
Extracts JSX text and copy attributes from changed files, runs each
string through the ContentRX API, and drops a single comment on the
PR summarizing any violations.

```yaml
- name: Content lint
  uses: thenewforktimes/contentrx-action@v1
  with:
    api-key: ${{ secrets.CONTENTRX_API_KEY }}
```

Violations are reported by default and the check passes — useful for
adopting the tool without breaking existing PRs. Flip `strict: true`
once your team is ready to enforce.

---

## Quickstart

Generate an API key at [contentrx.io/dashboard](https://contentrx.io/dashboard)
and stash it as a repository secret named `CONTENTRX_API_KEY`. Then
add this workflow:

```yaml
# .github/workflows/content-lint.yml
name: Content lint
on:
  pull_request:
    paths:
      - '**/*.tsx'
      - '**/*.jsx'
      - '**/*.html'

jobs:
  lint:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write   # needed to post the comment
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0     # so we can inspect the PR diff
      - uses: thenewforktimes/contentrx-action@v1
        with:
          api-key: ${{ secrets.CONTENTRX_API_KEY }}
```

The comment appears within ~30 seconds of the workflow starting, right
below the PR description.

---

## Inputs

| Name          | Required | Default                    | Description |
|---------------|----------|----------------------------|-------------|
| `api-key`     | yes      | —                          | Generated at the dashboard. Store as a repo secret. |
| `strict`      | no       | `false`                    | Fail the check when any violation is found. |
| `content-type`| no       | `short_ui_copy`            | Default `content_type` hint for extractor strings. |
| `paths`       | no       | `**/*.{tsx,jsx,html}`      | Glob for which files to extract from. |
| `api-url`     | no       | `https://contentrx.io` | Override for self-hosted / staging. |

## Outputs

| Name         | Description |
|--------------|-------------|
| `violations` | Total count across all checked strings. |
| `passed`     | `"true"` when there are no violations, `"false"` otherwise. |

---

## What gets extracted (v1)

- **JSXText** — content between tags: `<h1>Welcome back</h1>` → `"Welcome back"`
- **Copy attributes** — only these attrs are scanned:
  `alt`, `aria-label`, `label`, `placeholder`, `title`, `description`,
  `tooltip`, `subtitle`, `heading`, `text`, `message`, `content`

Skipped:
- `<script>`, `<style>`, `<noscript>`, `<code>`, `<pre>` inner text
- Interpolations (`${name}`, `{{ var }}`)
- Template literals (any `` ` `` in the value)
- Single-identifier tokens (`userName`) — likely variable refs, not copy

This is a regex-based extractor on purpose. A proper TypeScript AST
walk is planned for a later release. Falses positives here become
falses-positive violations — we're conservative about what we extract
to keep the comment signal-to-noise high.

---

## Exit behavior

| strict  | violations | workflow check | comment posted |
|---------|------------|----------------|----------------|
| `false` | 0          | pass           | yes ("no violations") |
| `false` | > 0        | pass           | yes (grouped by file) |
| `true`  | 0          | pass           | yes |
| `true`  | > 0        | **fail**       | yes |

---

## Scenarios

Three concrete ways this lands in a real engineering team.

### 1. Catching vague CTAs in a component refactor PR

A junior engineer opens a PR refactoring the pricing page. They
update a button:

```diff
-<Button>See pricing</Button>
+<Button>Click here to see our pricing plans</Button>
```

The action posts this comment on the PR:

> **ContentRX — 1 finding**
>
> **`src/app/pricing/page.tsx`**
>
> - Line 47: `"Click here to see our pricing plans"`
>   - [block] Vague CTA. "Click here" doesn't name the destination.
>     _Suggestion: "See pricing plans" or "View pricing"._

With `strict: false` (the default), the check still passes — the
review is advisory. Engineer pushes a fix in the next commit; comment
gets re-posted with 0 violations.

### 2. Enforcing on merge for copy-critical teams

Once the team's ready, flip `strict: true`:

```yaml
- uses: thenewforktimes/contentrx-action@v1
  with:
    api-key: ${{ secrets.CONTENTRX_API_KEY }}
    strict: true
```

Now any PR with a new violation fails the check, blocking merge under
a branch-protection rule. Useful for teams whose designer has signed
off on the 47-standard library as a hard gate.

### 3. Gradual rollout on a monorepo

You want to dogfood the action on the design-system package before
rolling it out to every app. Scope it by path:

```yaml
on:
  pull_request:
    paths:
      - 'packages/design-system/**/*.tsx'

jobs:
  lint:
    steps:
      - uses: thenewforktimes/contentrx-action@v1
        with:
          api-key: ${{ secrets.CONTENTRX_API_KEY }}
          paths: 'packages/design-system/**/*.tsx'
          strict: false
```

Violations only surface on design-system changes. Expand the `paths`
glob once the team agrees the signal is useful.

---

## Development

The action is a Python Docker action. To test locally:

```bash
cd github-action
pip install -e ../cli-client
pip install pytest
pytest tests/
```

To run a one-off extraction against a file:

```bash
python -c "
from pathlib import Path
import sys; sys.path.insert(0, 'src')
from extract import extract_strings
for e in extract_strings(Path('some/file.tsx')):
    print(e)
"
```

---

## Limitations (v1)

- **Regex extraction misses dynamic content.** Anything that flows
  through a template string or a translation function
  (`t('welcome_back')`) isn't visible to the extractor.
- **No comment replacement yet.** Multiple workflow runs create multiple
  comments on the same PR. A future version will update the existing
  comment in place.
- **Rate-limited by your plan.** Each extracted string is one API call.
  Free plans have 25 checks/month; a modest PR with 30 strings exhausts
  a Free quota in one run. Use a paid plan for CI.

## License

MIT. See [LICENSE](./LICENSE).
