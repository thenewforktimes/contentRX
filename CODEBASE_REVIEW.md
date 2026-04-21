# ContentRX codebase review

Reviewed: April 1, 2026
Scope: All source code in src/, cli/, figma-plugin/, tools/, tests/, pyproject.toml
Reviewer: Claude (requested by project owner)

## Executive summary

This is a well-architected codebase for a solo-developer project. The module
boundaries are clean, the data contracts in models.py are enforced everywhere
they matter, the separation between deterministic and LLM-based evaluation is
sound, and the documentation (ARCHITECTURE.md, inline comments, docstrings)
is genuinely excellent — better than most team-maintained projects. The
preprocessor design (VIOLATION/PASS/DEFER → post-processing suppression) is
a particularly elegant architectural pattern.

The issues below are the accumulated cost of iterative, session-by-session
development without periodic consolidation passes. None of them are
ship-blockers, but several would cause subtle bugs under load, and a few
create maintenance drag that compounds over time.

22 findings, organized by severity: 4 high, 8 medium, 10 low.


---


## HIGH — Fix before next feature work


### H1. JS/Python parity has drifted significantly

The JavaScript preprocessor in ui.html has diverged from preprocess.py in
ways that mean the Figma plugin evaluates content differently than the
Python CLI.

| Gap | Python | JavaScript |
|---|---|---|
| Preprocessor check count | 24 (incl. GRM-06) | 23 (missing GRM-06) |
| Standards library version | v4.5.0, 47 standards | v4.1.0, 46 standards |
| Classifier error signals | "problem"/"issue" removed | Still present (line 2434) |
| CON-02 safe phrases | 20 phrases in frozenset | Not implemented |
| ACT-01 binary response | Full check with compound prefix | Not implemented |
| Moment detection | 12 moments with all patterns | Moment detection present but weights not enforced |

Impact: A user running the Figma plugin gets different results than the
Python pipeline on the same text. This undermines trust in the tool and
makes eval data from plugin exports unreliable for calibration.

Recommendation: This is already on the patch queue (JS_PARITY_v450.md). It
should be the very next build session. The JS parity gap is your single
largest accuracy risk.


### H2. Bug: moment_suppressed_preprocess calculation in pipeline.py

Lines 5390-5393 in the merge stage:

```python
moment_suppressed_preprocess = len(preprocess_violations) - len([
    v for v in preprocess_violations
    if is_standard_active(v.standard_id, audience)
])
```

This variable name says "moment" but the logic filters by `is_standard_active`,
which is the audience gate, not the moment gate. The variable counts
audience-suppressed violations, not moment-suppressed ones. Additionally,
this variable is never used — it's computed and discarded. The actual
moment suppression count (`moment_suppressed_count` on line 5394) is correct.

Impact: No runtime impact since the value is unused, but dead computation
in the critical path of every check() call. More importantly, if someone
tries to use this variable later, they'd get the wrong value.

Recommendation: Delete lines 5390-5393 entirely. The correct count is
already computed on lines 5394-5398.


### H3. load_standards() reads and parses JSON from disk on every call

`load_standards()` is called in:
- `check()` (pipeline.py) — every single-string check
- `check_unfiltered()` (pipeline.py) — every library eval check
- `_check_consistency()` (batch.py) — every batch run
- `check_batch()` calls `check()` N times, so N+1 disk reads per batch

For a 50-string Figma page scan, that's 51 file reads and JSON parses of
the same unchanging file.

Impact: Not a correctness bug but an unnecessary performance tax. On
macOS with SSD it's fast enough to not notice, but it's the kind of thing
that becomes a problem at scale (e.g., if you ever build a server mode or
process a large code scanner export).

Recommendation: Add a module-level cache with a single-line change:

```python
_cache: dict | None = None

def load_standards(path=None) -> dict:
    global _cache
    if _cache is not None and path is None:
        return _cache
    # ... existing file-finding logic ...
    result = json.load(f)
    if path is None:
        _cache = result
    return result
```


### H4. Three different JSON parse failure behaviors

When the LLM returns unparseable JSON, each call site handles it differently:

| Call site | On JSONDecodeError |
|---|---|
| pipeline._llm_scan | Returns error result with "Failed to parse" summary |
| batch._check_consistency | Returns empty violations (silent swallow) |
| validate.validate_candidates | Returns all candidates as confirmed (assumes worst case) |

The validate behavior is defensible (fail-closed). The batch behavior is
dangerous — a consistency check failure is silently invisible to the user.
The pipeline behavior is reasonable but the user sees "error" in their
result without any ability to retry.

Recommendation: Standardize on a two-tier approach:
1. Log or surface the parse failure (never silently swallow)
2. Fail-closed: treat unparseable results as "could not evaluate" rather
   than "everything is fine"

Add a shared utility in a new `src/content_checker/api_utils.py`:

```python
def parse_llm_json(raw: str) -> dict:
    """Strip markdown fences and parse JSON. Raises on failure."""
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    return json.loads(cleaned.strip())
```

This also eliminates the duplicated fence-stripping code (currently
copy-pasted in pipeline.py, validate.py, batch.py, and
callAnthropicAPI in ui.html).


---


## MEDIUM — Address within the next 2-3 sessions


### M1. No retry logic on any API call

All three LLM call points (scan, validate, consistency) make a single
attempt. A transient 429 (rate limit) or 500 (server hiccup) causes the
entire check to fail with no recovery.

The Figma plugin does handle this slightly better (user-friendly error
messages), but neither path attempts a retry.

Recommendation: Add a simple retry wrapper with exponential backoff.
The Anthropic Python SDK has built-in retry support — you may only need
to configure the client:

```python
client = anthropic.Anthropic(max_retries=2)
```

This is a one-line fix in each call site.


### M2. Test files organized by session, not by module

Seven test files test the same preprocessor module:

| File | Tests | Origin |
|---|---|---|
| test_preprocess.py | 115 | Original build |
| test_preprocess_phase2.py | 81 | Phase 2 session |
| test_preprocess_phase3.py | 52 | Phase 3 session |
| test_triage_fixes.py | 54 | v4.3.1 triage |
| test_apple_patches.py | 62 | v4.4.1 Apple eval |
| test_v442_patches.py | 95 | v4.4.2 moments |
| test_v450_patches.py | 138 | v4.5.0 GRM-06 |

This makes it hard to find "all tests for GRM-05" or "all tests for the
Oxford comma check." When a check changes, you'd need to update tests
across 3-4 files.

Recommendation: Consolidate into one file per source module. For
preprocess.py, that's one `test_preprocess.py` organized by standard ID:

```python
class TestGRM01OxfordComma:
    ...
class TestGRM02Abbreviations:
    ...
```

This is already on the patch queue. Do it.


### M3. Duplicated utility code across tools/

The `_Colors` class appears in both `triage.py` (line 24499) and
`promote_cases.py` (line 22483) with slightly different implementations.
The markdown fence stripping logic is duplicated four times. The content
hashing function in promote_cases.py is standalone but could be shared.

Recommendation: Create `tools/shared.py` with the common utilities:
- `_Colors` class
- JSON fence-stripping
- Content hashing
- Logging helpers (_log, _log_ok, _log_warn, _log_err)


### M4. pyproject.toml version stuck at 4.0.0

The package version is `4.0.0` but the code is at v4.5.0 (per memory and
the v4.5.0 test file). The plugin's embedded LIBRARY_VERSION is `4.1.0`.
These should all agree.

Recommendation: Bump pyproject.toml to 4.5.0. Add a `__version__` to
`src/content_checker/__init__.py`. Use it as the single source of truth.


### M5. Inconsistent type annotation style

preprocess.py uses `Optional[str]` (typing module import), while every
other module uses `str | None` (PEP 604 union syntax, which requires
`from __future__ import annotations` and Python 3.10+). Since the project
requires Python 3.10+ (pyproject.toml), the union syntax is correct
everywhere.

Recommendation: Replace `Optional[str]` with `str | None` in preprocess.py
and remove the `from typing import Optional` import. This is a 2-minute
search-and-replace.


### M6. Dead code in code.js

The `get-selection` message handler (lines 361-383) is marked as "legacy"
but contains identical logic to `scan-selection` (lines 333-356). Both
deduplicate by node ID and post the same message type.

Recommendation: Remove the `get-selection` handler entirely, or replace
its body with a one-line delegation to the scan-selection logic.


### M7. tools/ data files in wrong location

`tools/extracted.json`, `tools/mailchimp_curated.json`, and
`tools/mailchimp_eval_cases.json` are eval data files living in the tools
directory. The project structure puts eval data in `evals/industry/`.

Recommendation: Move these to `evals/industry/` or `evals/staging/` (for
works-in-progress). This keeps tools/ as utilities-only.


### M8. tools/ has its own virtual environment

`tools/venv/` is a separate virtual environment from the project's `.venv/`.
This means `tools/extract_content.py` (which needs `requests` and
`beautifulsoup4`) runs in a different Python environment than the rest of
the project.

This is fine operationally, but it caused the codebase export to include
180,000+ lines of third-party library source code. It also means dependency
versions could drift between the two environments.

Recommendation: Add `tools/venv/` to a `.gitignore` equivalent (or your
export exclusion list). Long-term, consider adding the tools dependencies
to pyproject.toml as optional:

```toml
[project.optional-dependencies]
tools = ["requests>=2.31", "beautifulsoup4>=4.12"]
```


---


## LOW — Nice-to-have improvements


### L1. anthropic import inside functions

The `import anthropic` statement appears inside function bodies in
pipeline.py, classify.py, batch.py, and validate.py. This is a
deliberate lazy-import pattern (so the preprocessor-only path doesn't
require an API key), but it's repeated four times.

Recommendation: Centralize the lazy import in the proposed api_utils.py
module, or use a module-level conditional:

```python
try:
    import anthropic
except ImportError:
    anthropic = None
```


### L2. Audience toggle not wired in plugin UI

The ARCHITECTURE.md describes an audience-select dropdown in the plugin
UI and persistence via clientStorage. However, in the actual ui.html code,
there is no audience dropdown element, no audience-select handler, and no
clientStorage call for audience. The audience parameter is only available
in the Python CLI path.

Recommendation: Either build the toggle (it's described as designed) or
remove the "audience persistence" comment from code.js and clarify in
ARCHITECTURE.md that the plugin UI doesn't have this yet.


### L3. ui.html system prompt diverges from pipeline.py

The `buildSystemPrompt()` function in ui.html (line 2468) produces a
simpler prompt than `build_system_prompt()` in pipeline.py. The Python
version includes audience context, moment context, and content type
notes. The JS version has none of these.

This is related to H1 (JS parity) but worth noting separately because
the prompt difference affects LLM judgment quality, not just preprocessor
coverage.


### L4. No input validation on check() text parameter

`check("")` or `check("   ")` will classify an empty string, filter
standards for it, preprocess it, and send it to the LLM — wasting an
API call on nothing. Similarly, extremely long text (10,000+ characters)
will be sent to the LLM without any truncation or warning.

Recommendation: Add a guard at the top of check():

```python
text = text.strip()
if not text:
    return CheckResult(content_type="empty", overall_verdict="pass",
                       summary="Empty input."), 0.0, TokenUsage()
```


### L5. labels.py uses a linear search through categories

`get_display_label()` iterates through all categories and standards to
find a matching ID every time it's called. In a batch scan of 50 strings
with 3 violations each, that's 150 linear searches through 47 standards.

Not a real performance problem at current scale, but trivially fixable
with a one-time dict construction:

```python
_LABEL_CACHE: dict[str, str] | None = None

def _build_label_cache(standards_data):
    global _LABEL_CACHE
    cache = {}
    for cat in standards_data["categories"]:
        for std in cat["standards"]:
            cache[std["id"]] = std.get("display_label", std["id"])
    _LABEL_CACHE = cache
```


### L6. conftest.py fixture loads standards but tests also load directly

The test conftest.py provides a `standards` fixture, but several test
files (test_v450_patches.py, test_filter.py) also call `load_standards()`
directly inside test methods. This means some tests use the fixture and
some don't, creating an inconsistent testing pattern.

Recommendation: Standardize on the fixture everywhere.


### L7. BatchResult.total_tokens uses mutable default

```python
total_tokens: TokenUsage = field(default_factory=TokenUsage)
```

This is actually correct (field(default_factory=...) creates a new
instance per BatchResult), but the `__iadd__` implementation on TokenUsage
mutates in place. If two BatchResult instances were ever compared or
reused, the shared mutation pattern could cause confusion. Not a bug
today, but worth noting for future safety.


### L8. CLI model default hardcoded

The default model `claude-sonnet-4-20250514` appears as a string literal
in pipeline.py, classify.py, batch.py, validate.py, cli/main.py, and
ui.html. If Anthropic releases a new model, you'd need to update 6+ files.

Recommendation: Define once in a config module:

```python
# src/content_checker/config.py
DEFAULT_MODEL = "claude-sonnet-4-20250514"
```


### L9. No __all__ exports in several modules

audience.py, classify.py, filter.py, moments.py, preprocess.py, and
validate.py don't define `__all__`. This means `from module import *`
would pull in internal helpers. Not a practical problem since no code
uses star imports, but good hygiene for a package.


### L10. ARCHITECTURE.md needs version bump

ARCHITECTURE.md references 23 preprocessor checks and 46 standards.
The code has 24 checks and 47 standards. The preprocessor description
should be updated to include GRM-06. Already on the patch queue.


---


## What's genuinely excellent

These are things I'd hold up as examples of good architecture at any
company:

1. **The VIOLATION/PASS/DEFER preprocessor contract** is clean and
   composable. The post-processing suppression pattern (preprocessor PASS
   overrides LLM judgment) is exactly right — it means the deterministic
   layer has authority where it's confident, without blocking the LLM
   where it isn't.

2. **The merge stage as single point of suppression policy.** Audience
   gating and moment gating both happen in one place (lines 5361-5400 of
   pipeline.py). This makes the suppression behavior auditable and testable
   from one location instead of scattered across modules.

3. **The triage CLI (tools/triage.py) is production-grade.** The 4-layer
   architecture (display/data/input/flow), atomic saves, the keyboard
   shortcut system, the refinement logging — this is better than most
   internal tools at large companies. Zero dependencies is a good call.

4. **The auto-annotator's diversity-maximizing few-shot selection** in
   annotator_prompt.py is sophisticated. Seeding with disagreements, then
   filling by greedy diversity score, produces calibration prompts that
   cover the most informative edge cases first. This is a technique I'd
   recommend to other teams.

5. **The data contracts in models.py are enforced.** Every function in
   the package returns typed dataclasses, not raw dicts. The to_dict()
   methods make serialization explicit. This prevents the "mystery dict"
   problem that plagues most Python projects.

6. **The documentation density is appropriate.** Module docstrings explain
   the why, not just the what. The inline comments in preprocess.py trace
   each check back to its triage evidence. ARCHITECTURE.md is a genuine
   session-start anchor, not just boilerplate.


---


## Recommended session plan

**Session 1 (next): JS parity + consolidation**
- Apply JS_PARITY_v450.md patches to ui.html
- Fix H2 (dead moment_suppressed_preprocess variable)
- Fix M4 (version alignment)
- Fix M5 (Optional → union syntax)

**Session 2: Infrastructure cleanup**
- Fix H3 (standards caching)
- Fix H4 (shared JSON parse utility)
- Fix M1 (API retry)
- Fix M3 (shared tools utilities)
- Fix M6 (dead code.js handler)

**Session 3: Test consolidation**
- Fix M2 (merge 7 preprocess test files → 1)
- Fix L6 (standardize fixtures)
- Update ARCHITECTURE.md (L10)

**After that: Resume eval work**
