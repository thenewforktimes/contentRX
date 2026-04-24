"""Tests for scripts/check_case_study_approval.py.

Human-eval build plan Sessions 26–28. The guard blocks publication of
case studies that skip the plan's acceptance criteria (maintainer
approval, three judgment calls, matching route folder). These tests
use registry fixtures written to a temp path + a monkey-patched
REGISTRY_PATH so the script can run against them without touching the
real committed registry.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = REPO_ROOT / "scripts" / "check_case_study_approval.py"


def _load_script():
    spec = importlib.util.spec_from_file_location(
        "check_case_study_approval", SCRIPT_PATH
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def script():
    return _load_script()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

VALID_ENTRY = """\
    {
      slug: "linear-error-messages",
      project_name: "Linear",
      project_url: "https://linear.app",
      project_license: "MIT",
      published_at: "2026-05-01",
      maintainer_approval: true,
      approved_by: "linear-team@issue/1234",
      approved_at: "2026-04-28",
      teaser: "...",
      judgment_calls: [
        { summary: "one", standard_id: "VT-05", moment: "error_recovery", critique: "..." },
        { summary: "two", standard_id: "ACT-01", moment: "destructive_action", critique: "..." },
        { summary: "three", standard_id: "CLR-01", moment: "first_encounter", critique: "..." },
      ],
    }
"""

MISSING_APPROVAL_ENTRY = """\
    {
      slug: "unauthorized-study",
      project_name: "Whatever",
      project_license: "MIT",
      approved_by: "",
      approved_at: "2026-04-28",
      teaser: "...",
      judgment_calls: [
        { summary: "one", standard_id: "VT-05", moment: "error_recovery", critique: "..." },
        { summary: "two", standard_id: "ACT-01", moment: "destructive_action", critique: "..." },
        { summary: "three", standard_id: "CLR-01", moment: "first_encounter", critique: "..." },
      ],
    }
"""

TWO_CALLS_ONLY_ENTRY = """\
    {
      slug: "too-few-calls",
      project_license: "MIT",
      maintainer_approval: true,
      approved_by: "somebody",
      approved_at: "2026-04-28",
      teaser: "...",
      judgment_calls: [
        { summary: "one", standard_id: "VT-05", moment: "error_recovery", critique: "..." },
        { summary: "two", standard_id: "ACT-01", moment: "destructive_action", critique: "..." },
      ],
    }
"""


def _registry_with(entries: list[str]) -> str:
    body = ",\n".join(entries)
    return (
        "export const CASE_STUDIES = [\n"
        f"{body}\n"
        "];\n"
    )


# ---------------------------------------------------------------------------
# extract_registry_block
# ---------------------------------------------------------------------------


def test_extract_registry_block_returns_array_body(script):
    src = _registry_with([VALID_ENTRY.strip()])
    block = script.extract_registry_block(src)
    assert "slug: \"linear-error-messages\"" in block


def test_extract_registry_block_raises_when_missing(script):
    with pytest.raises(RuntimeError, match="Couldn't find `CASE_STUDIES`"):
        script.extract_registry_block("const OTHER = [];\n")


# ---------------------------------------------------------------------------
# split_entries
# ---------------------------------------------------------------------------


def test_split_entries_handles_nested_braces(script):
    src = _registry_with([VALID_ENTRY.strip(), VALID_ENTRY.strip()])
    block = script.extract_registry_block(src)
    entries = script.split_entries(block)
    # Two entries, each a single dict literal.
    assert len(entries) == 2
    for e in entries:
        assert e.startswith("{") and e.endswith("}")


# ---------------------------------------------------------------------------
# check_entry
# ---------------------------------------------------------------------------


def test_check_entry_passes_for_valid_registry_entry(tmp_path, monkeypatch, script):
    # Valid entry points at slug "linear-error-messages" — fake a
    # matching route folder so the existence check passes.
    slug_dir = tmp_path / "docs-site" / "app" / "case-studies" / "linear-error-messages"
    slug_dir.mkdir(parents=True)
    (slug_dir / "page.mdx").write_text("stub")
    monkeypatch.setattr(script, "CASE_STUDIES_DIR", slug_dir.parent)
    errors = script.check_entry(VALID_ENTRY)
    assert errors == []


def test_check_entry_flags_missing_maintainer_approval(tmp_path, monkeypatch, script):
    monkeypatch.setattr(script, "CASE_STUDIES_DIR", tmp_path)  # ignored path
    errors = script.check_entry(MISSING_APPROVAL_ENTRY)
    assert any("maintainer_approval: true" in e for e in errors)


def test_check_entry_flags_too_few_judgment_calls(tmp_path, monkeypatch, script):
    monkeypatch.setattr(script, "CASE_STUDIES_DIR", tmp_path)
    errors = script.check_entry(TWO_CALLS_ONLY_ENTRY)
    assert any("3 judgment_calls" in e for e in errors)


def test_check_entry_flags_missing_route_folder(tmp_path, monkeypatch, script):
    monkeypatch.setattr(script, "CASE_STUDIES_DIR", tmp_path)
    errors = script.check_entry(VALID_ENTRY)
    assert any("no folder at" in e for e in errors)


def test_check_entry_flags_folder_without_page(tmp_path, monkeypatch, script):
    # Folder exists but has neither page.mdx nor page.tsx.
    slug_dir = tmp_path / "linear-error-messages"
    slug_dir.mkdir()
    monkeypatch.setattr(script, "CASE_STUDIES_DIR", tmp_path)
    errors = script.check_entry(VALID_ENTRY)
    assert any("no page.mdx or page.tsx" in e for e in errors)


# ---------------------------------------------------------------------------
# Empty-registry scaffolding state
# ---------------------------------------------------------------------------


def test_script_passes_on_empty_registry(tmp_path, monkeypatch, script, capsys):
    registry = tmp_path / "case-studies.ts"
    registry.write_text(_registry_with([]))
    monkeypatch.setattr(script, "REGISTRY_PATH", registry)
    monkeypatch.setattr(script, "CASE_STUDIES_DIR", tmp_path)
    rc = script.main()
    assert rc == 0
    captured = capsys.readouterr()
    assert "scaffolding state" in captured.out.lower()


def test_script_fails_when_registry_file_is_missing(tmp_path, monkeypatch, script, capsys):
    monkeypatch.setattr(script, "REGISTRY_PATH", tmp_path / "not-here.ts")
    rc = script.main()
    assert rc == 1
    captured = capsys.readouterr()
    assert "does not exist" in captured.err.lower()
