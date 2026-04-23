# Changelog

ContentRX ships as a Python engine plus six user-facing surfaces in one
repo. Each surface has its own version. This file tracks user-visible
changes per surface, in reverse chronological order.

---

## Engine — `src/content_checker/`

Source of truth: `src/content_checker/__init__.py` (`__version__`).

### 4.6.1 — 2026-04-22

- Added per-violation `confidence` field (0–1) on LLM-flagged
  violations. Low-confidence violations (< 0.7) promote to the
  `review_recommended` verdict instead of `violation`.
- Prompt now includes calibration anchors so the confidence score is
  well-distributed instead of collapsing to 0.95 for everything.

### 4.6.0 — 2026-04-22 (v2 Session 10)

- New verdict state: `REVIEW_RECOMMENDED`. First-class alongside
  `VIOLATION` and `PASS`. Surfaces it through every API, client, and
  output format.
- `Verdict` enum + `confidence: float` + `review_reason:
  Optional[ReviewReason]` fields on every violation.
- Confidence policy: LLM confidence < 0.7 OR moment-classifier
  confidence < 0.6 → REVIEW; otherwise VIOLATION or PASS as before.
- Bumped API schema_version to 1.1.0 (minor, additive).

### 4.5.1 — 2026-04-22 (v2 Session 3)

- `src/content_checker/api_utils.py` — single source for LLM JSON
  parsing (`parse_llm_json`). Replaces three divergent parse sites.
- All Anthropic clients now pass `max_retries=2`.
- `load_standards()` reads disk once per process; subsequent calls hit
  a module-level cache.

### 4.5.0 — 2026-04-22 (v2 Session 2)

- JS/Python preprocessor parity gate in CI
  (`.github/workflows/parity.yml`). 53 cases, 53/53 agreement. Any
  divergence fails the PR.

---

## Web app — `src/app/` + `src/app/api/`

The API surface is versioned via the `schema_version` field in every
response envelope. Following semver; minor = additive, major =
breaking. See `docs/API_VERSIONING.md`.

### schema 1.1.0 — 2026-04-22 (PR #29)

- Added: `verdict`, `confidence`, `review_reason` on every violation
  (additive).
- Added: override-capture endpoints — `POST /api/violations/override`,
  `GET /api/team-analytics/overrides`.
- Added: `/dashboard/overrides` analytics page.

### schema 1.0.0 — 2026-04-22 (PR #28)

- Introduced the schema-versioning envelope: every API response carries
  `schema_version` (semver) and an optional `warnings` array. Existing
  clients keep working via additive envelope siblings.
- `docs/API_VERSIONING.md` documents the policy.

### Infrastructure

- **2026-04-23 (PR #38):** Row-level security enabled on all eight
  public tables (defense-in-depth). FK indexes added on
  `ditto_syncs.user_id`, `team_members.member_user_id`,
  `violation_overrides.violation_id`.
- **2026-04-22 (PR #30):** `violation_overrides` table added (Session 11).

---

## MCP server — `contentrx-mcp` on PyPI

### 0.3.0 — 2026-04-22

- Forwards `verdict`, `confidence`, `review_reason` on every violation
  (wired to engine 4.6.0).
- `evaluate_copy` now returns the REVIEW_RECOMMENDED state distinctly.

### 0.2.0 — 2026-04-22

- New tools: `explain_violation(standard_id)` and
  `list_standards(moment=None)`.
- New resources: `contentrx://standards`, `contentrx://standards/{id}`,
  `contentrx://moments`.
- New prompt: `review_ui_copy` — multi-step workflow that classifies,
  evaluates, and summarizes UI copy in a file or diff.

### 0.1.0 — 2026-04-22

- Initial release. Tools: `evaluate_copy`, `classify_moment`.
- Auth via `CONTENTRX_API_KEY` env var.
- Install: `uvx contentrx-mcp`.

---

## CLI — `contentrx-cli` on PyPI

### 0.1.0 — 2026-04-22

- Initial release. Commands: `contentrx check`, `contentrx check-batch`.
- Stdlib-only HTTP client (no `requests` or `httpx` dependency).
- Auth via `CONTENTRX_API_KEY` env var.
- Exit codes are part of the public API (see README).

---

## GitHub Action — `github-action/`

In-tree today; not yet on GitHub Marketplace. See repo README for the
copy-paste install snippet.

### 2026-04-22

- Comment truncation above 60 KB with a "see logs" fallback (fixes
  GHA-C-01 — GitHub's 65 KB comment ceiling).
- Pagination via `Link: rel="next"` for PRs with > 100 changed files
  (fixes GHA-C-02).
- Committed `package-lock.json`; install step now uses `npm ci`.

---

## Figma plugin — `figma-plugin/`

### 2026-04-22

- Tailwind `AlertDialog` replaces raw `window.confirm` in the
  api-key-panel and rules client.
- CallbackShell ported to Tailwind dark mode.
- Quota-exhausted banner rebuilt with `createElement` / `textContent` /
  `insertBefore`. Accessibility: `role="alert"`.
- Full ARIA pass: `node-card-header` is a `<button>` with
  `aria-expanded`; progress bars have `role=progressbar` +
  `aria-valuenow` kept in sync via `setProgressBar` helper.
- Clipboard-failure inline message; select-all on the key code.
- `DEV_MODE` flipped to `false` for Figma Community submission.

---

## Docs site — `docs-site/` (live at `docs.contentrx.io`)

### 2026-04-23

- Live at `docs.contentrx.io` with HTTPS. Standards library auto-renders
  from the engine's canonical `standards_library.json`, refreshed on
  every build via a `prebuild` npm script that copies the file into
  `docs-site/lib/`.
- Imports the JSON instead of `readFileSync` so webpack bundles the
  data at build time (PR #37).

### 2026-04-22

- Initial build: 57 SSG pages covering 47 standards across 9 categories
  and 8 moment types. Next.js 15 + MDX.

---

## Monorepo chores

### 2026-04-23

- Renamed `contentrx.app` → `contentrx.io` across docs + email sender
  (PR #33). `docs.contentrx.io` is now the canonical docs domain.
- Added `SECURITY.md` and this `CHANGELOG.md` at repo root.
- `CLAUDE.md` Known Limitations updated — items 2 (quota race) and 3
  (webhook idempotency) marked resolved with citations.

---

## Schema-version policy (reminder)

- **Minor bump** (1.0.0 → 1.1.0): additive field, new endpoint, new
  enum value. Old clients keep working.
- **Major bump** (1.x → 2.0): removed field, changed type, changed
  required-ness. Announced via a `warnings` entry in the envelope for
  at least one full minor cycle before the breaking change ships.
- Deprecations ride in `warnings[]` without bumping the version until
  a minor or major is released.
