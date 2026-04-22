# cli-client — Claude Code instructions

**Read this file first. Every session working in `cli-client/`.**

## What this is

The PyPI-published thin client for the ContentRX API. Imported by
`pip install contentrx-cli`, invoked as `contentrx`. Lives alongside the
engine + backend app in the same repo so the three ship on one branch,
but it is **not** coupled to the engine source: the CLI does not import
anything from `content_checker`.

## Locked architectural decisions

- **Stdlib-only runtime.** No `requests`, no `httpx`. `urllib.request` is
  the entire HTTP stack. Keeps the PyPI supply-chain surface minimal.
- **Auth is `CONTENTRX_API_KEY` env var.** No config files, no flags.
- **Exit codes are part of the public API.** Pinned in README. Don't
  repurpose them.
- **`contentrx = contentrx.main:main`.** Module name matches the command
  name; the package directory is `cli-client/contentrx/`.

## What not to do

- Don't add runtime dependencies without a PR-sized justification. Every
  dep is a supply-chain risk and an install-time cost users pay.
- Don't import from the engine (`content_checker`). The CLI is a pure
  HTTP client; engine logic runs server-side.
- Don't bypass `CONTENTRX_API_KEY` validation — no fallbacks, no "try
  without auth." If the key is missing or bad, print the dashboard URL
  and exit non-zero.
- Don't log the raw API key. Not to stderr, not to `--verbose` output.
- Don't persist anything to disk. The CLI is read-only from the user's
  POV.

## Testing

```bash
cd cli-client
pip install -e ".[dev]"
pytest tests/
```

Tests mock `urllib.request.urlopen`; no network access required.

## Release checklist (when pushing a new version to PyPI)

1. Bump `__version__` in `contentrx/__init__.py` AND `version` in
   `pyproject.toml` — they must match.
2. Update `README.md` if the CLI surface changed.
3. `pytest tests/` green.
4. `python -m build` (produces `dist/*.whl` and `dist/*.tar.gz`).
5. `python -m twine upload dist/*` (requires PyPI API token).
6. Verify `pip install --upgrade contentrx-cli` in a clean venv picks
   up the new version and `contentrx --version` reports it.
