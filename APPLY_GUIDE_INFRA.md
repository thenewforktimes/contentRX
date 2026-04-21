# v4.5.1 infrastructure patch — apply guide

Applied: 2026-04-01
Scope: H3 (standards caching), H4 (shared JSON parse), M1 (API retry),
       M2 (test consolidation skeleton), M5 (type annotations),
       ARCHITECTURE.md update, all call sites wired

## File destinations

Every file is fully patched. Copy each to its destination — no manual edits needed.

| File | Destination | Action |
|---|---|---|
| `api_utils.py` | `src/content_checker/api_utils.py` | NEW — shared LLM interface |
| `loader.py` | `src/content_checker/standards/loader.py` | REPLACE — adds caching |
| `pipeline.py` | `src/content_checker/pipeline.py` | REPLACE — wired to api_utils |
| `validate.py` | `src/content_checker/validate.py` | REPLACE — wired to api_utils |
| `batch.py` | `src/content_checker/batch.py` | REPLACE — wired to api_utils, silent swallow fixed |
| `preprocess.py` | `src/content_checker/preprocess.py` | REPLACE — docstring count fix |
| `test_api_utils.py` | `tests/test_api_utils.py` | NEW |
| `test_loader.py` | `tests/test_loader.py` | NEW |
| `test_preprocess_consolidated.py` | `tests/test_preprocess_consolidated.py` | NEW — M2 skeleton |
| `ARCHITECTURE.md` | `ARCHITECTURE.md` (project root) | REPLACE |

## After applying

```bash
cd ~/Desktop/content-standards-checker

# 1. Reinstall the package (new module added)
pip install -e .

# 2. Run the new tests first (fast feedback)
python3 -m pytest tests/test_api_utils.py tests/test_loader.py -v

# 3. Run the full test suite
python3 -m pytest tests/ -v

# 4. Verify infrastructure
python3 -c "
from content_checker.standards.loader import load_standards, get_cache_info
from content_checker.api_utils import DEFAULT_MODEL, LLMResponse

data = load_standards()
info = get_cache_info()
print(f'Standards: {info[\"standard_count\"]}')
print(f'Cached: {info[\"cached\"]}')
print(f'Default model: {DEFAULT_MODEL}')

# Verify cache hit
data2 = load_standards()
print(f'Cache hit (same object): {data is data2}')
"
```

Expected output:
```
Standards: 47
Cached: True
Default model: claude-sonnet-4-20250514
Cache hit (same object): True
```

## What changed in each file

### api_utils.py (NEW — H4 + M1 + L8)

The single highest-leverage file in this patch. Centralizes:

- **JSON parsing:** `parse_llm_json()` with `ParseError` exception. Stage-specific
  wrappers (`parse_scan_response`, `parse_validation_response`,
  `parse_consistency_response`) normalize missing keys. Fence stripping handled
  once, not copy-pasted four times.
- **Client creation:** `get_client(max_retries=2)` gives automatic retry on
  429/500/502/503 across every API call. Cached at module level.
- **LLM messaging:** `create_message()` returns `LLMResponse` dataclass with
  `text`, `input_tokens`, `output_tokens`. Doesn't depend on `models.py`
  to avoid circular imports — callers construct `TokenUsage` from the fields.
- **Constants:** `DEFAULT_MODEL` defined once. All call sites reference it.

### loader.py (REPLACE — H3)

Module-level cache eliminates N+1 disk reads per batch. Custom paths bypass
the cache (test fixtures stay isolated). `get_cache_info()` for diagnostics.
`_reset_cache()` for test teardown.

### pipeline.py (REPLACE)

- `_llm_scan()` now uses `create_message()` + `parse_scan_response()`.
  No more lazy `import anthropic`, no fence stripping, no `json.loads`.
  Token tracking preserved via `LLMResponse.input_tokens/output_tokens`.
- `check()` and `check_unfiltered()` model defaults → `DEFAULT_MODEL`.
- Docstring: "10 canonical moments" → "12 canonical moments".
- `check_unfiltered()` PipelineMeta fallback: 46 → 47.

### validate.py (REPLACE)

- Uses `create_message()` + `parse_llm_json()`. No lazy import, no fence
  stripping. Token tracking preserved.
- Model default → `DEFAULT_MODEL`.
- Fail-closed behavior preserved: `ParseError` → all candidates confirmed.
- Docstring documents the fail-closed contract explicitly.

### batch.py (REPLACE — critical fix)

- Uses `create_message()` + `parse_llm_json()`. No lazy import, no fence
  stripping. Token tracking preserved.
- Model default → `DEFAULT_MODEL`.
- **CRITICAL FIX:** `_check_consistency()` no longer silently swallows
  `JSONDecodeError`. Previous behavior returned `[]` on parse failure,
  which is indistinguishable from "checked and found no issues." Now
  returns `None` on failure. `check_batch()` handles `None` explicitly
  and logs a warning.

### preprocess.py (REPLACE — docstring only)

- "Check inventory (24 checks)" → "Check inventory (25 checks)".
  The code already had 25 registered checks (GRM-06 added in v4.5.0),
  only the docstring was stale.

### moments.py (NO CHANGE)

Already current — trust_permission regex expansion and all 12 moments
were in the uploaded version.

## Test consolidation (M2) — next step

The `test_preprocess_consolidated.py` skeleton is ready. Migration process:

1. Copy to `tests/test_preprocess_consolidated.py`
2. For each of the 7 source files, move tests into the matching class
3. Run: `python3 -m pytest tests/test_preprocess_consolidated.py -v`
4. Verify count: `python3 -m pytest tests/test_preprocess_consolidated.py --co -q | tail -1`
5. Delete the 7 source files, rename consolidated to `test_preprocess.py`
6. Run full suite: `python3 -m pytest tests/ -v`

## Codebase review resolution summary

| Finding | Severity | Status |
|---|---|---|
| H1 JS/Python parity | High | Resolved v4.5.1 (previous session) |
| H2 Dead variable | High | Resolved v4.5.1 (previous session) |
| H3 Standards caching | High | **Resolved this patch** — loader.py |
| H4 Shared JSON parse | High | **Resolved this patch** — api_utils.py |
| M1 API retry | Medium | **Resolved this patch** — max_retries=2 |
| M2 Test consolidation | Medium | Skeleton delivered, migration next |
| M3 Shared tools utils | Medium | Deferred |
| M4 Version alignment | Medium | Resolved v4.5.1 (previous session) |
| M5 Type annotations | Medium | Already applied in uploaded preprocess.py |
| L8 Model default centralized | Low | **Resolved this patch** — DEFAULT_MODEL |
| L10 ARCHITECTURE.md stale | Low | **Resolved this patch** |

**All 4 High findings resolved. 5 of 8 Medium findings resolved.**
