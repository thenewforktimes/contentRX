# ContentRX build plan v2: north-star-aligned surfaces

Target: ship ContentRX as a serious developer tool for engineering and
product teams, in the tools they already use, with a human evaluation
layer that no competitor has. Twenty sessions, sequenced by leverage,
each session shippable on its own.

Version: v5.0.0 (this plan), supersedes BUILD_PLAN.md for all new work.

---

## ⚠️ BEFORE EVERY SESSION: READ CLAUDE.md

Unchanged from v1. Every Claude Code session begins with
`view /CLAUDE.md` in the relevant repo. No exceptions. The file contains
the locked architectural decisions, naming conventions, and
non-negotiables for this build. Re-reading is cheap. Re-litigating stack
choices is not.

Updates to CLAUDE.md that this plan introduces are in **Appendix A**.

---

## The north star, restated

> ContentRX is a product for engineering teams, product management
> teams, and everyone else who wants staff-level content-design review
> in their files. Right where the work happens. Full stop.

Every session below either (a) advances a surface your ICP lives in,
(b) closes a credibility gap that would make an engineer reject the
tool on evaluation, or (c) adds a human evaluation primitive that
differentiates ContentRX from every competing tool in the category.
If a task does not do one of those three things, it does not belong
in this plan.

---

## Philosophy — five principles this plan is built on

**1. The engine is the asset; the surfaces are the surface area.** The
Python pipeline, the moment classifier, the standards library, the
preprocessor — those are the product. A Figma plugin, an MCP server, a
GitHub Action, an LSP — those are the distribution. The Figma plugin
proved the engine under real load. Now the engine ships on three more
surfaces. Nothing about the engine is being thrown away.

**2. Credibility floor first. Surfaces second. Features third.** An
engineer evaluating a new tool in 2026 makes a trust decision in the
first five minutes. If Clerk is in test mode, if the JS and Python
verdicts disagree on the same string, if the API retries are missing,
the evaluation ends before the interesting features get seen. Phase 0
exists to raise that floor.

**3. The MCP server is the single most important new build.** Not the
LSP. Not the PM integrations. Not the docs site. The MCP server is what
turns ContentRX from "a thing designers run on Figma frames" into "a
thing Claude Code consults before writing a button label." It is the
generation-layer reposition in one artifact. Everything else in Phase
1 supports it.

**4. Human evaluation is a product surface, not a back-office
discipline.** Your 334-case eval corpus and EVAL_PROTOCOL.md are how
*you* know the tool works. The product has to give *customers* a way
to know the tool works and to calibrate it to their team. That is the
differentiator. Every competitor hides their accuracy. ContentRX
publishes it.

**5. Every session ships. Nothing requires atomic commitment.**
Phases are sequenced by leverage, not by interdependency. Each
session's acceptance criteria are testable on their own. If later
phases slip, earlier ones still stand. Pace it however works for you.

---

## What engineers actually evaluate when they open a dev tool

You asked me to be the architect because you haven't been immersed in
engineering tool evaluation. Here is the actual mental model, so that
every session decision below makes sense to you and so that you can
apply it yourself going forward. This is also Appendix B, for
reference.

When an engineer lands on a new dev tool, they make a yes/no trust
decision in roughly this order:

1. **README in 30 seconds.** Can they tell what it does, who it is
   for, and what problem it solves — without marketing language? If
   no, they close the tab.
2. **Install in 5 minutes.** Can they get a hello-world result in the
   time it takes to make coffee? If it requires a demo call or a
   sign-up form before they can try it, they close the tab.
3. **Output looks right.** When it runs, does the output look like
   something a careful engineer would produce? Structured. Diffable.
   Machine-readable. Not marketing text.
4. **Security story is explicit.** Where do my strings go? How long
   are they kept? Is there a SECURITY.md? Is there a data model doc?
   Silence here reads as negligence.
5. **Versioning is disciplined.** Semver on the API payload. Changelog
   in the repo. Deprecation notices. If v2 silently broke v1
   consumers, they stop trusting the maintainer.
6. **Tests exist and run.** Not coverage percentage — existence and
   CI. An empty `tests/` directory is a red flag. A green CI badge is
   a green light.
7. **Issues are alive.** Not empty, not a graveyard. Someone responds.
8. **Pricing is visible.** Self-serve pricing visible on the site means
   "I can adopt this without procurement." "Contact sales" means "this
   isn't for me yet."
9. **The author respects their own hot path.** No 51 disk reads for a
   50-string scan. No three different JSON parse failure behaviors.
   Small craft signals that the author cares.
10. **Docs cite real use cases.** Not "for teams that want to ship
    better content." "For Next.js apps using shadcn/ui, here is how
    ContentRX catches CTA violations in your `Button` children props."

Every session in this plan is designed against this list. When in
doubt about a tradeoff, this list is the tiebreaker.

---

## Phases at a glance

| Phase | What ships |
|---|---|
| **Phase 0** | Credibility floor — live keys, parity gate, retries, caches |
| **Phase 1** | MCP server — the reposition |
| **Phase 2** | GitHub Action publish + OSS campaign |
| **Phase 3** | Human-eval v1 — verdict states + override capture |
| **Phase 4** | Human-eval v2 — dry-run, reports, golden set, accuracy page |
| **Phase 5** | LSP server + editor extensions |
| **Phase 6** | Content model as public spec |

Do them in order. Phase 0 is the floor and must come first. Phase 1
is the reposition and should come second. Past that the order holds
but the cadence is yours.

---

## Phase 0 — Credibility floor

The goal of Phase 0 is: no engineer who evaluates ContentRX after
this phase ships can reject it on "this feels amateur" grounds. These
are small, surgical fixes that together move the product from
"solo-dev side-project" to "serious tool."

### Session 1 — Clerk live mode + env provisioning

**Objective.** Replace Clerk test keys with live keys, provision a new
webhook secret, provision Resend, Sentry, Plausible. Ship.

**Prereqs.** None. Start here.

**Files.** `.env.production` (Vercel), `src/lib/clerk.ts` (if any
references to test mode), `src/middleware.ts` (verify still works).

**Acceptance.**
- Vercel production env has `CLERK_SECRET_KEY` starting with `sk_live_`
- Vercel production env has `CLERK_WEBHOOK_SECRET` rotated and set
- Vercel production env has `RESEND_API_KEY`, `SENTRY_DSN`,
  `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` set
- `hello@contentrx.io` sends a test welcome email to Robo's personal
  inbox via Resend
- Sentry receives a deliberate test error from production
- Plausible dashboard shows a live visit to `contentrx.io`
- ⚠ annotation removed from ARCHITECTURE.md

**Why this matters.** This is the `.env` session. No new features. The
purpose is to stop shipping a product that a security-aware engineer
would immediately bounce on. Do it first because it unblocks real
customer access and because every subsequent session is pointless if
production is still in test mode.

**Claude Code opener.**
```
Read /CLAUDE.md first.

Task: promote ContentRX to production-grade environment. Replace Clerk
test keys with live keys. Provision Resend, Sentry, and Plausible per
ARCHITECTURE.md section 4 ("What's blocking which flow"). Remove all
test-mode annotations from ARCHITECTURE.md.

Acceptance criteria are in BUILD_PLAN_v2.md Session 1. Proceed.
```

---

### Session 2 — JS/Python parity gate in CI

**Objective.** Make JS/Python verdict divergence impossible to ship.
This is the single largest accuracy risk in the product (H1 from
CODEBASE_REVIEW.md) and the signal engineers trust least.

**Prereqs.** Session 1 complete.

**Files.**
- `tools/parity_check.py` (new) — runs corpus through both runtimes,
  diffs results
- `.github/workflows/parity.yml` (new) — CI job that fails on any
  divergence
- `figma-plugin/ui.html` — apply JS_PARITY_v450.md patches
- `tests/corpus/parity_corpus.json` (new) — subset of 334-case corpus
  used for parity verification (start with 50, scale later)

**Acceptance.**
- `python3 tools/parity_check.py` runs the parity corpus through
  Python pipeline and a headless Node harness running the JS
  preprocessor
- Exit code 0 on full agreement, exit code 1 on any divergence with a
  diff printed
- CI runs on every PR and every push to main
- CI currently passes — i.e., the JS_PARITY_v450.md patches have been
  applied and JS v4.5.0 matches Python v4.5.0
- Parity corpus is documented in `tests/corpus/README.md`

**Why this matters.** Customers running the plugin on a string and
then the CI action on the same string have a right to the same
verdict. Today they don't get it. Structurally solving this is the
difference between "this is a toy" and "this is a linter." It is also
what lets you truthfully claim "write once, enforce everywhere."

**Longer-term note.** The right architectural end state is a single
source of truth for preprocessor rules — either a JSON DSL both
runtimes interpret, or compiling Python to WASM via Pyodide. Don't
build that now. Ship the CI gate now. Log the architectural follow-up
as a P2 for Phase 6 or later.

**Claude Code opener.**
```
Read /CLAUDE.md first. Then read JS_PARITY_v450.md and the H1 section
of CODEBASE_REVIEW.md.

Task: apply the JS_PARITY_v450.md patches so figma-plugin/ui.html JS
preprocessor matches preprocess.py at v4.5.0. Then build
tools/parity_check.py and .github/workflows/parity.yml per Session 2
of BUILD_PLAN_v2.md. Use a 50-case parity corpus drawn from the
existing 334-case eval corpus; document selection criteria in
tests/corpus/README.md.

CI must fail loudly on any divergence. Ship when the badge is green.
```

---

### Session 3 — Retries, JSON parse standardization, and cache

**Objective.** Fix H3, H4, and M1 from CODEBASE_REVIEW.md in one
session. These are all small, they're all in the hot path, and they
all signal craft.

**Prereqs.** Session 2 complete.

**Files.**
- `src/content_checker/api_utils.py` (new) — shared JSON parse utility
- `src/content_checker/pipeline.py` — use shared utility, add retries
- `src/content_checker/validate.py` — use shared utility
- `src/content_checker/batch.py` — use shared utility, fix silent swallow
- `src/content_checker/standards.py` (or wherever `load_standards` is)
  — add module-level cache

**Acceptance.**
- `anthropic.Anthropic(max_retries=2)` is set on every client instance
- All four JSON parse sites import `parse_llm_json` from api_utils
- No site silently swallows `JSONDecodeError` — all raise or log
- `load_standards()` reads disk once per process; subsequent calls
  return cached result
- New test `tests/test_api_utils.py` covers `parse_llm_json` for:
  plain JSON, markdown-fenced JSON, malformed JSON, empty string
- Existing test suite still passes (1,010 tests, 0 failures)

**Why this matters.** Each of these is a small thing. Together they
are the difference between "the author cared" and "the author shipped
the first version that worked." Engineers notice.

**Claude Code opener.**
```
Read /CLAUDE.md first. Then read the H3, H4, and M1 sections of
CODEBASE_REVIEW.md.

Task: implement Session 3 of BUILD_PLAN_v2.md. Create
src/content_checker/api_utils.py with parse_llm_json. Refactor all
four call sites (pipeline.py, validate.py, batch.py, and the Anthropic
call in figma-plugin/ui.html) to use it. Add max_retries=2 to every
Anthropic client. Add module-level cache to load_standards. Write
tests/test_api_utils.py.

Existing 1,010-test suite must still pass. Ship when tests are green.
```

---

## Phase 1 — MCP server

The goal of Phase 1 is to ship the single most important new surface:
an MCP server that lets Claude Code, Cursor, Claude desktop, and any
other MCP client consult ContentRX before UI copy gets written. This
is the generation-layer reposition. This is what takes ContentRX from
"a Figma plugin plus a CLI" to "the content-design review layer for
AI-assisted development."

### Background: what MCP is, in one paragraph

MCP (Model Context Protocol) is an open standard Anthropic released in
late 2024 for connecting LLM clients to tools and data. An MCP server
is a small program that speaks the protocol over stdio or HTTP and
exposes three primitives: **tools** (functions the LLM can call),
**resources** (read-only content like docs or standards the LLM can
reference), and **prompts** (prebuilt workflows users can invoke). Any
MCP client — Claude Code, Cursor, Claude desktop, Zed, a growing list
— can load any MCP server via a config file. This is the standard
that makes "AI tools talk to your product" a one-line install for end
users.

### Session 4 — MCP server scaffold

**Objective.** Stand up a working MCP server that exposes the first
two tools, speaks stdio, authenticates with a `cx_` token, and
installs via `uvx contentrx-mcp`.

**Prereqs.** Phase 0 complete.

**Files.**
- `mcp-server/` (new directory at repo root)
  - `pyproject.toml` — declares package `contentrx-mcp`
  - `src/contentrx_mcp/__init__.py`
  - `src/contentrx_mcp/server.py` — main entry point
  - `src/contentrx_mcp/client.py` — thin HTTP client to `/api/check`
  - `src/contentrx_mcp/auth.py` — reads `CONTENTRX_API_KEY` from env
  - `README.md` — install + config + example
- `.github/workflows/publish_mcp.yml` (new) — publishes to PyPI on tag

**Tools to expose in this session (two only, keep scope tight).**

- `evaluate_copy(text: str, moment_hint: Optional[str], context: Optional[str]) -> EvaluationResult`
  - Description: "Check UI copy against content design standards.
    Returns violations with moment classification, rule citations, and
    severity."
  - Thin wrapper over `POST /api/check`.
- `classify_moment(text: str) -> MomentClassification`
  - Description: "Classify what kind of UI moment a string is — error,
    empty state, CTA, confirmation, etc. Useful to run before writing
    copy for a new component."
  - Thin wrapper over the classifier portion of the pipeline.

**Acceptance.**
- `uvx contentrx-mcp` launches the server and it speaks MCP over stdio
- Adding the snippet below to `~/.config/claude/claude_desktop_config.json`
  makes the tools appear in Claude desktop:
  ```json
  {
    "mcpServers": {
      "contentrx": {
        "command": "uvx",
        "args": ["contentrx-mcp"],
        "env": { "CONTENTRX_API_KEY": "cx_..." }
      }
    }
  }
  ```
- Both tools callable from Claude desktop; results round-trip correctly
- Tool descriptions are under 120 characters each and verb-first
- Package publishable to PyPI (dry-run via `uv publish --dry-run`)
- Rate limit responses (429) surface as retryable MCP errors, not as
  stack traces

**Why this matters.** This is the whole reposition in one session. By
the end of this session ContentRX exists inside Claude Code and
Cursor, which is where your engineering ICP already writes copy. The
demo video for this one session is the whole launch narrative.

**Claude Code opener.**
```
Read /CLAUDE.md first. Read MCP server specification at
https://modelcontextprotocol.io/specification (latest). Read
BUILD_PLAN_v2.md Session 4.

Task: create mcp-server/ package per BUILD_PLAN_v2.md. Use the MCP
Python SDK (mcp[cli]). Expose evaluate_copy and classify_moment tools
as thin wrappers over /api/check. Auth via CONTENTRX_API_KEY env var.
Target install flow: uvx contentrx-mcp.

Do not expose any tool that isn't listed in the plan for this session.
Additional tools are Session 5.

Ship when the tools are callable from Claude desktop.
```

---

### Session 5 — MCP server: resources, prompts, remaining tools

**Objective.** Round out the MCP server with `explain_violation`,
`list_standards`, a resource endpoint for standards, and a `/review`
prompt that runs a full UI copy review as a workflow.

**Prereqs.** Session 4 complete.

**Files.**
- `src/contentrx_mcp/server.py` — expanded
- `src/contentrx_mcp/resources.py` (new) — resource handlers
- `src/contentrx_mcp/prompts.py` (new) — prompt definitions
- `README.md` — updated with all tools, resources, prompts

**Tools to add.**
- `explain_violation(standard_id: str) -> StandardExplanation`
  — rationale, examples, anti-patterns
- `list_standards(moment: Optional[str]) -> list[StandardSummary]`
  — filterable catalog

**Resources to add.**
- `contentrx://standards` — directory of all standards
- `contentrx://standards/{id}` — single standard as markdown
- `contentrx://moments` — all moment types with definitions

**Prompts to add.**
- `review_ui_copy` — "Review the UI copy in this file or diff. For
  each string, call classify_moment then evaluate_copy. Summarize
  violations by severity and cite the standards."

**Acceptance.**
- All four tools callable from Claude desktop
- Resources appear in Claude desktop's resource picker
- `/review_ui_copy` prompt appears in Cursor and Claude desktop
- End-to-end demo: open a React component file, invoke
  `/review_ui_copy`, get a structured review with citations
- Package version bumped to 0.2.0 and republished to PyPI

**Why this matters.** Tools alone are useful. Resources + prompts are
what make an MCP server feel like a real integration rather than a
function wrapper. The `/review_ui_copy` prompt is the artifact an
engineer shares with their team ("hey, try this") and it's what drives
organic adoption.

**Claude Code opener.**
```
Read /CLAUDE.md first. Read BUILD_PLAN_v2.md Session 5.

Task: expand the MCP server from Session 4 with two additional tools
(explain_violation, list_standards), three resources
(contentrx://standards/*, contentrx://moments), and one prompt
(review_ui_copy).

Tool descriptions must be under 120 characters, verb-first. Resource
URIs must follow the pattern documented in MCP spec.

End-to-end test: run /review_ui_copy in Claude desktop against a
sample React component and verify a structured review comes back.
```

---

### Session 6 — MCP distribution push

**Objective.** Make the MCP server discoverable. This is a
marketing/distribution session, not a code session.

**Prereqs.** Session 5 complete. MCP server published to PyPI.

**Deliverables.**
- 90-second demo video: "Claude Code writes a button label, ContentRX
  catches the violation." Post to Twitter/X, Loom, LinkedIn.
- Short-form writeup: "ContentRX for Claude Code: content-design
  review in the generation layer." Post to dev.to, Hacker News (pick
  the right time slot), Anthropic MCP directory submission.
- `.mcp.json` snippet on `contentrx.io/mcp` as a copy-paste install
- Direct outreach: 5 MCP-active accounts on Twitter/X (Cursor team,
  Claude Code team, known MCP tool authors). Not promotion — sharing,
  asking for feedback.

**Acceptance.**
- Video live on at least Twitter/X and LinkedIn
- Writeup live on dev.to
- Anthropic MCP directory submission in flight
- `contentrx.io/mcp` page live with copy-paste install
- At least 20 MCP server installs measurable via PyPI download stats
  within 72 hours of launch

**Why this matters.** The MCP server is pointless without distribution.
This session is the soft launch that determines whether the reposition
reaches its audience. It is also the first piece of content-marketing
discipline the product needs — a rehearsal for the OSS campaign in
Phase 2 and the accuracy page in Phase 4.

---

## Phase 2 — GitHub Action publish + OSS campaign

### Session 7 — GitHub Action marketplace publish

**Objective.** Move the GitHub Action from 🟡 (in-tree, inert) to 🟢
(public repo, marketplace listed).

**Prereqs.** Phase 1 complete.

**Files.**
- New public repo: `github.com/contentrx/contentrx-action`
  - `action.yml`
  - `README.md` with Marketplace badge
  - `LICENSE` (MIT)
- Back-reference from main repo README

**Acceptance.**
- Action listed on GitHub Marketplace
- README includes a 30-second copy-paste example in a `dev-tool-copy`
  job
- Example repo (`contentrx/contentrx-action-example`) with working PR
  that demonstrates the action commenting violations

**Why this matters.** The GitHub Action is already built. It is
inert. This is the single cheapest credibility win available — a few
hours of repo plumbing unlocks the primary "engineers see the tool on
their PRs" moment.

---

### Session 8 — OSS dev-tool content-review campaign

**Objective.** The "State of UI copy in open-source developer tools"
moment the strategy memo calls for.

**Prereqs.** Session 7 complete.

**Deliverables.**
- Run ContentRX against 5 high-visibility OSS dev tools (suggested:
  Prettier, Vite, Bun, uv, or similar — pick tools that actually
  ship UI). Use only the CLI + the GitHub Action — do not require
  Figma access.
- Write a short report: top violation patterns, most common moment
  errors, specific illustrative examples. Credit the tools, avoid
  punching down.
- Open polite PRs to 2–3 of the tools with specific fixes. If declined,
  that's fine — the PR link is the marketing artifact either way.
- Post to Hacker News, dev.to, Reddit r/programming.

**Acceptance.**
- Report live on `contentrx.io/posts/state-of-oss-dev-tool-copy`
- At least 2 PRs opened against OSS projects
- Post submitted to Hacker News at a deliberate time (Tuesday–Thursday
  morning Pacific)
- New GitHub stars on contentrx-action measurable

**Why this matters.** This is where the first engineer customers
come from. The post does four jobs simultaneously: it proves the tool
works, it demonstrates the GitHub Action, it creates specific
before/after examples that become case studies, and it hits the
audience (engineers on HN) that matches the ICP.

**Risk note.** Do not open PRs that punch down. Frame every finding
as a friendly collaboration. The goal is credibility, not controversy.
If a maintainer responds poorly, apologize, close, move on.

---

## Phase 3 — Human-eval v1

Up to this point the product has been exclusively code and
distribution. Phase 3 is where ContentRX starts growing the human
evaluation primitives that differentiate it from every competitor. This
phase is deliberately small — three sessions, one primitive per session.
Phase 4 builds on it.

### Session 9 — API schema versioning envelope

**Objective.** Add `schema_version` to every API response before any
customer pins against v1 and before Session 10 changes the payload
shape.

**Prereqs.** Phase 2 complete.

**Files.**
- `src/app/api/check/route.ts` — wrap response in envelope
- `src/app/api/team-rules/route.ts` — same
- `src/app/api/team-analytics/route.ts` — same
- `src/content_checker/models.py` — `EvaluationEnvelope` wrapping
  existing `EvaluationResult`
- `figma-plugin/ui.html` — read `data.result` not `data` directly
- `cli/contentrx/*` — same
- `mcp-server/src/contentrx_mcp/client.py` — same
- `docs/API_VERSIONING.md` (new) — one-page policy

**Schema shape.**
```json
{
  "schema_version": "1.0.0",
  "result": { ... existing payload ... },
  "warnings": []
}
```

**Acceptance.**
- All three API routes return the envelope
- All three clients (plugin, CLI, MCP) read from the envelope
- Version policy documented: minor bump for additive fields, major
  bump for breaking changes, warnings field for deprecation notices
- Existing test suite passes
- A deliberate deprecation test: add a field, bump minor, verify old
  client still works

**Why this matters.** Schema versioning is table-stakes for any public
API. Doing it before Session 10 means the verdict-state change doesn't
break any existing customer. This is the single most engineer-credible
hygiene move you can make.

---

### Session 10 — Defer-to-human verdict state

**Objective.** Add `review_recommended` as a first-class verdict
state. Surface it everywhere. This is the first product primitive that
encodes "staff-level review" — a staff content designer knows when to
defer; the product now does too.

**Prereqs.** Session 9 complete.

**Files.**
- `src/content_checker/models.py` — add `Verdict` enum
  (`VIOLATION`, `REVIEW_RECOMMENDED`, `PASS`); add `confidence: float`
  and `review_reason: Optional[ReviewReason]` fields
- `src/content_checker/pipeline.py` — populate verdict based on LLM
  confidence + moment classifier confidence + override history
- `figma-plugin/ui.html` — render yellow "review recommended" state
  distinct from red violation / green pass
- `src/app/api/check/route.ts` — pass through new fields; bump
  schema_version minor to 1.1.0
- `cli/contentrx/output.py` — render REVIEW state distinctly in
  terminal output
- `github-action/` — REVIEW comments styled differently from violations;
  do not fail the CI check on REVIEW alone (configurable)
- `mcp-server/src/contentrx_mcp/server.py` — propagate new fields

**Confidence policy.**
- If LLM confidence (from self-reported or logprobs) < 0.7 → REVIEW
- If moment classifier confidence < 0.6 → REVIEW
- If historical override rate for this (team, standard, moment) > 30%
  → REVIEW with `review_reason: "high_override_rate"`
- Otherwise VIOLATION or PASS as before

**Acceptance.**
- New `Verdict.REVIEW_RECOMMENDED` enum value added and tested
- Pipeline populates `verdict`, `confidence`, `review_reason`
- Figma plugin renders three distinct visual states
- CLI renders three distinct visual states
- GitHub Action posts three distinct comment styles
- MCP server tool responses include new fields
- Default behavior: REVIEW does not block CI (configurable via
  `fail-on: violation` vs `fail-on: review`)
- schema_version bumped to 1.1.0; `warnings` field empty
- 20 new test cases added to parity corpus covering low-confidence
  scenarios

**Why this matters.** This is the first primitive no competitor has.
Ditto, Frontitude, Grammarly, Figma AI — all of them output binary
verdicts. A staff-level review is not binary. Making the product
honest about uncertainty is both a product-quality win and a
marketing wedge.

---

### Session 11 — Override capture

**Objective.** When a user dismisses a violation, capture it. Turn
dismissals into implicit labels. This is the feedback loop that makes
the content model get better over time — and a retention lever.

**Prereqs.** Session 10 complete.

**Files.**
- `src/db/schema.ts` — new `violation_overrides` table:
  ```
  (id, team_id, user_id, violation_id, standard_id, moment,
   text_hash, override_reason, override_type, created_at)
  ```
  - `override_type`: `'dismiss' | 'accept_as_review' | 'mark_false_positive'`
  - `override_reason`: optional free-text
- `src/app/api/violations/[id]/override/route.ts` (new) — POST endpoint
- `figma-plugin/ui.html` — dismiss button records override
- `github-action/` — `/contentrx ignore` bot command on PR comments
  records override
- `src/app/api/team-analytics/overrides/route.ts` (new) — aggregates
  per team

**Acceptance.**
- Dismissing a violation in the plugin writes a row to
  `violation_overrides`
- Commenting `/contentrx ignore CLR-01` on a PR that has a ContentRX
  comment writes a row
- Team analytics endpoint returns override counts grouped by
  (standard_id, moment)
- Dashboard page `/dashboard/overrides` renders the analytics as a
  simple table (Recharts optional here; table is fine for v1)
- Privacy: only hash + rule ID + moment are stored globally; plaintext
  never stored; team_id scoped to team

**Why this matters.** Two reasons. One, override data is the implicit
labeling set that drives the public content model updates in Phase 6 —
"rules overridden >25% across >20 teams get reviewed." Two, the "rules
you override most" report is exactly the kind of self-aware surface
that makes a team believe the tool is calibrating *to them*, not just
enforcing *against them*. That is the retention hook.

---

## Phase 4 — Human-eval v2

Four sessions. Each one is a standalone feature that closes a specific
gap none of the competitors have filled. By the end of Phase 4,
ContentRX has a human evaluation layer that is probably the strongest
differentiator in the category.

### Session 12 — Rule dry-run preview

**Objective.** Before a team owner commits a rule change (disable,
add, override), show what the change would have done on the last 30
days of team history. Prevent footguns.

**Prereqs.** Phase 3 complete.

**Files.**
- `src/app/api/team-rules/preview/route.ts` (new) — POST endpoint
  that accepts a proposed change + window, re-scores historical
  violations, returns diff
- `src/content_checker/rules_engine.py` — extracted rule application
  logic so it can be called in dry-run mode without DB writes
- `src/app/dashboard/rules/page.tsx` — preview UI before commit

**Request shape.**
```
POST /api/team-rules/preview
{
  "change": { "action": "disable", "standard_id": "CLR-01" },
  "window": "30d"
}
→ {
  "schema_version": "1.0.0",
  "result": {
    "would_remove_violations": 14,
    "would_add_violations": 0,
    "would_convert_to_review": 3,
    "sample_before": [...],
    "sample_after": [...]
  }
}
```

**Acceptance.**
- Preview endpoint returns in under 2 seconds for typical team history
  (<5000 violations in window)
- Dashboard rule-edit page shows the preview diff inline before
  commit button enables
- Works for all three rule change types: disable, add, override
- Sample before/after items are deduplicated; at most 10 shown

**Why this matters.** This is the feature that closes Team-tier deals.
Every buyer who has used Datadog or LaunchDarkly expects
preview-before-commit on any config change. Its absence will feel
amateur to them. Its presence will not be remarkable — it will feel
right, which is what you want.

---

### Session 13 — Override rate report + rule review queue

**Objective.** Surface "rules you override most" as a dashboard page
and as a weekly email. For the product owner (you), surface
cross-team override rates as the rule-review queue.

**Prereqs.** Session 12 complete.

**Files.**
- `src/app/dashboard/overrides/page.tsx` — team-scoped override report
- `src/emails/WeeklyOverrideDigest.tsx` (new) — weekly Resend email
- `src/app/admin/rule-review/page.tsx` (new, internal only) —
  cross-team aggregation for rule review

**Acceptance.**
- Team dashboard shows top 10 most-overridden (standard, moment)
  pairs with counts
- Weekly email sent to team owners every Monday with top 5 overrides
  and a one-click link to disable any of them
- Internal admin page lists rules with >25% override rate across >20
  teams, sorted by impact
- Rate-limiting: email only if there are >3 overrides in the week

**Why this matters.** The team-facing report is retention. The
internal rule-review queue is how you justify content model updates
in Phase 6 with data, not opinion. "We retired CLR-09 because 63
teams overrode it an average of 41% of the time" is the kind of
release note that wins trust.

---

### Session 14 — Team golden set primitive

**Objective.** Let teams accept verdicts into a private "golden set"
and mark others as false positives. Over time this becomes each team's
content model extension.

**Prereqs.** Session 13 complete.

**Files.**
- `src/db/schema.ts` — new `team_golden_set` table:
  ```
  (id, team_id, text_hash, moment, verdict, rationale,
   added_by_user_id, added_at)
  ```
- `src/app/api/golden-set/route.ts` (new) — CRUD endpoints
- `src/app/dashboard/golden-set/page.tsx` (new) — list + search UI
- `figma-plugin/ui.html` — "add to golden set" button on verdicts
- `github-action/` — `/contentrx gold` bot command
- `src/content_checker/pipeline.py` — golden set consulted during
  evaluation: exact hash match short-circuits to team's accepted verdict

**Acceptance.**
- Team members can add a verdict to the golden set from the plugin or
  PR comment
- Golden set items are deduplicated by text_hash per team
- Evaluations against a string whose hash exists in the team's golden
  set short-circuit to the stored verdict (with a
  `"matched_golden_set": true` flag in the result)
- Dashboard shows golden set with search and filter by moment
- Export: team owners can download their golden set as JSON

**Why this matters.** This is the retention mechanism. A team with a
500-item golden set will not churn — it would mean throwing away
months of calibration work. It is also a data asset that informs the
public content model (aggregated, anonymized) and that differentiates
ContentRX Team from ContentRX Pro at the product level, not just the
pricing level.

---

### Session 15 — Public accuracy page

**Objective.** Publish quarterly accuracy numbers at
`contentrx.io/accuracy`. Every competitor hides this. ContentRX
publishes it.

**Prereqs.** Session 14 complete.

**Files.**
- `src/app/accuracy/page.tsx` (new) — public accuracy report
- `tools/accuracy_report.py` (new) — generates report from eval corpus
- `tests/corpus/held_out/` (new) — held-out 100-case subset that is
  not used for training or tuning

**Content shape.**
```
ContentRX accuracy report — v4.7.0 (Q2 2026)

Overall agreement with senior content designer verdicts: 96.4% (100/100 
cases in held-out set, drawn from 6 production design systems).

By moment:
- Error messages: 98% (49/50)
- Empty states: 94% (17/18)
- CTAs: 100% (22/22)
- ...

Known failure modes:
- Over-triggers CLR-01 on ironic microcopy (3 cases)
- Misses ACT-02 on compound CTAs with emoji (1 case)
...

Eval protocol: [link to EVAL_PROTOCOL.md]
Methodology: [link]
Full held-out corpus: gated behind email signup
```

**Acceptance.**
- Page live at `contentrx.io/accuracy`
- Report generated reproducibly from `tools/accuracy_report.py`
- Held-out corpus is version-controlled but not used in preprocessor
  development (verified by git history)
- Footer on every page links to /accuracy
- Every customer-facing email mentions accuracy once in the footer:
  "Verified against 100 held-out cases — see our accuracy report."

**Why this matters.** The accuracy page does three jobs. It is the
honest version of "staff-level review" as a marketing claim. It is a
compounding SEO asset (nobody else has this, so it ranks fast). And
it forces you to own your failure modes, which is the single strongest
credibility signal available to a solo-founder product.

**Note on ownership.** Your memory says after every 3rd evaluation or
major build block you want a proactive context-length check-in and a
full context summary. This session is exactly that kind of milestone.
Plan for a post-session writeup that covers: (1) what shipped, (2)
what's in the patch queue, (3) what's next. This rhythm continues
through Phases 5 and 6.

---

## Phase 5 — LSP server + editor extensions

The goal of Phase 5 is to add the second editor-level surface. LSP
(Language Server Protocol) is the standard that lets any editor light
up violations inline — VS Code, Cursor, Zed, Neovim, JetBrains IDEs.
One protocol, many clients.

### Session 16 — LSP server scaffold

**Objective.** Stand up a working LSP server that emits diagnostics on
string literals in JSX/TSX files.

**Prereqs.** Phase 4 complete.

**Files.**
- `lsp-server/` (new directory at repo root)
- `src/contentrx_lsp/server.py` — main LSP entry point
- `src/contentrx_lsp/parser.py` — JSX/TSX parser using tree-sitter
- `src/contentrx_lsp/diagnostics.py` — conversion from violations to
  LSP diagnostics

**Acceptance.**
- `uvx contentrx-lsp` launches the server over stdio
- Server responds to `initialize`, `textDocument/didOpen`,
  `textDocument/didChange`, `textDocument/publishDiagnostics`
- Given a `.tsx` file with a `<Button>Click here</Button>` (CTA
  violation), the server emits a diagnostic on the string range with
  severity, message, and standard ID
- Diagnostics update on edit within 500ms
- Rate-limited to 2 evaluations per second per document

**Why this matters.** LSP is the inline-while-typing surface. MCP is
the "ask Claude" surface. They are complementary. An engineer with
ContentRX LSP installed sees copy violations appear in their editor's
problems panel as they type, the same way TypeScript errors appear.
That is the highest-engagement surface possible.

---

### Session 17 — Code actions + fix suggestions

**Objective.** Add `textDocument/codeAction` support so engineers can
right-click a violation and get suggested fixes.

**Prereqs.** Session 16 complete.

**Files.**
- `src/contentrx_lsp/code_actions.py` (new)
- `src/contentrx_lsp/server.py` — register code action provider

**Acceptance.**
- On a violation diagnostic, the editor shows "Quick Fix" options
- Primary action: "Replace with [suggested rewrite]" — calls a new
  endpoint `/api/suggest-fix` that uses Claude to rewrite
- Secondary action: "Show standard rationale" — opens the standard's
  documentation URL
- Tertiary action: "Mark as false positive" — writes to override
  table (reusing Session 11 infrastructure)

**Why this matters.** Diagnostics without fixes are annoying.
Diagnostics *with* fixes are useful. Code actions convert ContentRX
from "a linter that tells you you're wrong" into "a linter that helps
you be right." That is the distinction that drives adoption.

---

### Session 18 — VS Code and Cursor extensions

**Objective.** Publish thin VS Code and Cursor extensions that launch
the LSP server automatically. One-click install, no config.

**Prereqs.** Session 17 complete.

**Files.**
- `editor-extensions/vscode/` (new)
  - `package.json` — VS Code extension manifest
  - `src/extension.ts` — launches LSP server, handles config
- `editor-extensions/cursor/` (new) — likely same codebase, different
  manifest (Cursor is largely VS Code compatible)

**Acceptance.**
- Extension published to VS Code Marketplace as "ContentRX"
- Extension published to Cursor extensions (if separate marketplace
  exists by now) or instructions for installing the VS Code version
- One-click install flow: extension prompts for API key on first
  activation, stores in OS keychain
- Extension renders ContentRX's logo in the status bar with current
  violation count
- 50+ installs within 2 weeks of launch

**Why this matters.** Most engineers will not configure an LSP server
by hand. The extension is the install path. VS Code Marketplace is
the distribution channel. Without this session, the LSP work does not
reach its audience.

---

## Phase 6 — Content model as public spec

Phase 6 is where the content model stops being a JSON file in the repo
and becomes a public, versioned, browsable spec — the "Shopify Polaris
of executable content rules" the strategy memo calls for.

### Session 19 — docs.contentrx.io launch

**Objective.** Ship the docs site at `docs.contentrx.io` with the
content model as the centerpiece.

**Prereqs.** Phase 5 complete.

**Files.**
- `docs-site/` (already exists in repo, currently inert)
- Second Vercel project binding `docs.contentrx.io`
- Content pages:
  - `/` — what is ContentRX, who it's for, 3-minute install
  - `/standards` — browsable standards library
  - `/standards/[id]` — single standard page
  - `/moments` — browsable moment types
  - `/moments/[id]` — single moment type page
  - `/guides` — install guides per surface (MCP, LSP, GitHub Action,
    CLI, Figma plugin)
  - `/accuracy` — links to main site accuracy page

**Acceptance.**
- `docs.contentrx.io` resolves and renders
- Standards library browsable, searchable, linkable
- Each violation emitted by ContentRX (in any surface) includes a
  `docs_url` field pointing to the relevant standard page
- Lighthouse score >90 on perf and accessibility
- Sitemap submitted to Google Search Console

**Why this matters.** The docs site is the public face of the content
model. Every violation now deep-links to a rationale, examples, and
anti-patterns. This closes the loop on "cite the standard" — today the
standard ID is emitted but there is nowhere to go.

---

### Session 20 — Versioned standards + OSS license

**Objective.** Version the standards library publicly. Release v1.0 of
the content model under a permissive license.

**Prereqs.** Session 19 complete.

**Files.**
- New public repo: `github.com/contentrx/content-model`
- `LICENSE` — CC-BY 4.0 (permissive for standards, requires
  attribution)
- `standards_library.json` — canonical, versioned
- `SPEC.md` — the numbered spec the strategy memo calls for
- `CHANGELOG.md` — version history
- Docs site reads from GitHub-pinned version at build time

**Acceptance.**
- Repo live and permissively licensed
- SPEC.md is readable as a standalone document
- CHANGELOG.md covers every version from v4.5.0 forward
- Docs site displays the current version in the footer with a link
  to the repo
- Main ContentRX repo cites the spec repo as the source of truth
  (engine reads from it, rather than carrying its own copy)

**Why this matters.** Open-sourcing the taxonomy while keeping the
engine commercial is the Tailwind/shadcn playbook. It earns credibility,
compounds via SEO and citations, makes design-system partnerships
conceivable, and makes ContentRX acquirable (by Ditto, Figma, or GitHub)
rather than crushed. It is also the move that makes the "content model
as moat" thesis from the strategy memo real and not aspirational.

---

## Appendix A — CLAUDE.md updates for v5

Add the following sections to CLAUDE.md at repo root:

### Surfaces, in order of primacy

1. MCP server (Python, stdio, via `uvx contentrx-mcp`) — engineers in
   Claude Code / Cursor / Claude desktop
2. LSP server (Python, stdio, via `uvx contentrx-lsp`) — engineers
   typing in any LSP client
3. GitHub Action — engineers on PRs
4. CLI — engineers in terminals and CI
5. Figma plugin — designers and PMs working in Figma
6. Web dashboard — admins configuring teams

The plugin is no longer the headline. The MCP server is.

### Non-negotiables (additions)

- `schema_version` on every API response, semver'd
- All LLM JSON parses go through `parse_llm_json` in `api_utils.py`
- All Anthropic clients have `max_retries=2`
- JS/Python parity is CI-gated; divergence blocks merge
- Every violation emitted includes a `docs_url`
- Every verdict is one of `violation | review_recommended | pass`
- Override dismissals write to `violation_overrides` table (never
  silently discarded)

### Banned shortcuts

- No new surfaces that bypass the engine (every surface calls the same
  `/api/check` or the same underlying pipeline)
- No silently-swallowed errors (fail-closed, log, surface)
- No "contact sales" gating on self-serve-appropriate tiers
- No accuracy claims without a link to the accuracy page

---

## Appendix B — What engineers evaluate when opening a dev tool

Reproduced from the Philosophy section for easy reference. Use this
as the tiebreaker when making any scope or quality tradeoff.

1. README tells them what it does in 30 seconds
2. Install in 5 minutes, hello-world result
3. Output is structured, diffable, machine-readable
4. Security story is explicit (SECURITY.md, data model doc)
5. API versioning is disciplined (semver, changelog)
6. Tests exist and run in CI
7. Issues are alive
8. Pricing is visible and self-serve
9. The author respects their own hot path (no wasted disk reads, no
   three different error-handling behaviors)
10. Docs cite real use cases, not generic marketing language

---

## Appendix C — Session opener template

Every Claude Code session starts from this template. Fill in the
italicized pieces; keep the structure fixed.

```
Read /CLAUDE.md first. Read BUILD_PLAN_v2.md Session [N].

Context:
- Current version: [v5.x.x]
- Previous session: [what shipped]
- Outstanding patch queue: [items from previous session]

Task: [one-sentence objective]

Files to touch: [list from Session]

Acceptance criteria: [list from Session]

Non-negotiables:
- Every Anthropic client has max_retries=2
- Every API response includes schema_version
- JS/Python parity CI must stay green
- No silently-swallowed errors

After completing the task:
1. Run the full test suite
2. Update ARCHITECTURE.md if surfaces changed
3. Update CHANGELOG.md with what shipped
4. If this is session 3, 6, 9, 12, 15, 18, or 20: produce a full
   context summary covering what was built, what carries over, and
   what the next session should start with, listing every output file
   with its exact destination path.

Ship when acceptance criteria pass.
```

---

## A note on momentum

You built BUILD_PLAN v1 in 36 hours. This plan is smaller in aggregate
scope but broader in surface count. At your pace, Phase 0 is a
weekend. Phase 1 is another weekend. The full plan is weeks, not
months, if you choose to push it.

The constraint isn't the hours. The constraint is the sequencing.
Phase 0 before Phase 1 before anything else — because the credibility
floor determines whether engineers get past the first five minutes,
and the MCP server is the single move that repositions the whole
product. Past those two, the ordering is still recommended but the
cadence is yours.

If you only ship Phases 0 and 1, ContentRX is materially repositioned
from where it is today. If you ship through Phase 4, ContentRX has a
human evaluation layer no competitor has. If you ship all the way to
Phase 6, ContentRX is a category-naming product with an open spec,
a public accuracy record, and four editor-level surfaces.

The plan does not require all of it. Start with Phase 0. Ship the MCP
server right after. Everything else follows from there.
