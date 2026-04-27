# github-action — Claude Code instructions

**Read this file first. Every session working in `github-action/`.**

## What this is

The ContentRX GitHub Action. Ships as a Docker-backed action that
pip-installs `contentrx-cli` at build time, extracts UI copy from
changed files in a pull request, and posts a single comment
summarizing violations.

Lives in `github-action/` inside the main contentRX repo for now.
BUILD_PLAN §12 intends this to be split into a separate public repo
(`contentrx-action`) before submission to the GitHub Marketplace —
the action.yml, Dockerfile, and src/ can be copied over verbatim when
that happens.

## Locked architectural decisions

- **Regex extractor, not AST.** v1 uses a targeted regex over JSXText
  and a closed allowlist of copy-holding attributes. BUILD_PLAN §15
  upgrades to a TypeScript AST walk.
- **Sticky comment.** As of PR-39 the action looks up its prior
  comment via a `<!-- contentrx-action-sticky-comment -->` marker and
  PATCHes it on every push. First-run still POSTs (no marker found);
  subsequent runs update in place. Pre-PR-39 historical comments
  stay as artifacts and aren't touched.
- **Docker action, not JS/Composite.** Lets us pip-install
  `contentrx-cli` in a consistent Python environment without dragging
  Node into the action runtime.
- **Stdlib-only inside the Docker image.** The action source (not the
  CLI it wraps) doesn't install `requests` or anything else. urllib is
  enough for the GitHub API calls.
- **GH API via GITHUB_TOKEN.** The workflow must grant
  `permissions: { pull-requests: write }` for comment posting.

## What not to do

- Don't add runtime Python dependencies beyond the CLI. Every dep
  slows the cold start of the Docker container.
- Don't post multiple comments per run. If you want more detail, make
  the comment longer; don't fragment it across comments.
- Don't post inline review comments (file-level). Issue comments on
  the PR are simpler and don't require git blob IDs.
- Sticky behaviour delivered in PR-39. Don't fragment the comment
  across multiple posts; if more detail is needed, make the comment
  longer.
- Don't expand the copy-attribute list without thinking. False
  positives here are worse than missed strings.
- Don't call `contentrx` more than once per unique string. If a line
  appears in two files (copy-pasta), each file-site gets reported, but
  the API call is the same; safe to cache within a single run if we
  need to in future.

## Testing

```bash
cd github-action
pip install -e ../cli-client     # provides `contentrx` on PATH
pytest tests/
```

Tests mock `run_contentrx`, `_fetch_changed_from_api`, and
`post_comment`; no network or subprocess required.

## Release checklist (when publishing to Marketplace)

1. Split `github-action/` to its own public repo (`contentrx-action`).
2. Tag the release (`v1`, `v1.0.0`) with `gh release create`.
3. From the repo **Releases** page, check "Publish this Action to the
   GitHub Marketplace".
4. Update the `uses:` line in [README.md](./README.md) once the
   Marketplace listing is live.
5. Pin `contentrx-cli` to a known-good version in the Dockerfile's
   `pip install` line — don't let `>=0.1.0,<1.0` drift to something
   untested on action startup.
