"""Tests for the Markdown report renderer."""

from __future__ import annotations

from report import FileReport, MAX_COMMENT_CHARS, render_markdown


def _report(path: str, entries: list[dict]) -> FileReport:
    return FileReport(path=path, entries=entries)


def test_no_violations_renders_clean_summary() -> None:
    md = render_markdown([], total_strings=8)
    assert "No content-standard violations" in md
    assert "8 strings" in md


def test_violations_rollup_counts() -> None:
    reports = [
        _report(
            "src/Button.tsx",
            [
                {
                    "text": "Click here to learn more",
                    "line": 4,
                    "kind": "jsx-text",
                    "violations": [
                        {"standard_id": "ACC-01", "issue": "Avoid click here.", "suggestion": "Be descriptive."},
                        {"standard_id": "ACT-02", "issue": "Vague verb.", "suggestion": "Use a specific verb."},
                    ],
                }
            ],
        ),
        _report(
            "src/Input.tsx",
            [
                {
                    "text": "Submit",
                    "line": 10,
                    "kind": "attr:label",
                    "violations": [
                        {"standard_id": "ACT-01", "issue": "Non-descriptive submit.", "suggestion": "Use a specific verb."}
                    ],
                }
            ],
        ),
    ]
    md = render_markdown(reports, total_strings=12)
    assert "3 violations" in md
    assert "2 files" in md
    assert "12 strings" in md
    assert "`src/Button.tsx`" in md
    # Schema 2.0.0 — substrate IDs (ACC-01, ACT-01, etc.) are NEVER
    # rendered to PR comments. The PR comment surfaces issue +
    # suggestion + severity only.
    assert "ACC-01" not in md
    assert "ACT-02" not in md
    assert "ACT-01" not in md
    assert "Click here to learn more" in md
    assert "Avoid click here." in md
    assert "Be descriptive." in md


def test_reports_with_only_non_violating_entries_are_hidden() -> None:
    reports = [
        _report(
            "src/Clean.tsx",
            [{"text": "Save", "line": 1, "kind": "jsx-text", "violations": []}],
        ),
    ]
    md = render_markdown(reports, total_strings=1)
    # Falls through to the "no violations" path because nothing failed.
    assert "No content-standard violations" in md


def test_escapes_backticks_in_snippet() -> None:
    reports = [
        _report(
            "src/X.tsx",
            [
                {
                    "text": "Use `code` format",
                    "line": 1,
                    "kind": "jsx-text",
                    "violations": [
                        {"standard_id": "X", "issue": "bad", "suggestion": ""},
                    ],
                }
            ],
        ),
    ]
    md = render_markdown(reports, total_strings=1)
    assert "`" + "code" + "`" not in md  # raw backticks got replaced


def test_truncates_long_snippets() -> None:
    long_text = "x" * 200
    reports = [
        _report(
            "src/X.tsx",
            [
                {
                    "text": long_text,
                    "line": 1,
                    "kind": "jsx-text",
                    "violations": [{"standard_id": "X", "issue": "bad"}],
                }
            ],
        ),
    ]
    md = render_markdown(reports, total_strings=1)
    # Snippet is truncated to 80 chars with an ellipsis.
    assert "…" in md
    assert "x" * 200 not in md


def test_overlong_report_is_truncated_under_github_limit() -> None:
    """A PR with hundreds of violating files must not blow past
    GitHub's 65,536-char comment-body cap (GHA-C-01)."""
    reports: list[FileReport] = []
    for i in range(300):
        reports.append(
            _report(
                f"src/components/File{i:04d}.tsx",
                [
                    {
                        "text": f"Call to action number {i} with longer descriptive text",
                        "line": 10 + i,
                        "kind": "jsx-text",
                        "violations": [
                            {
                                "standard_id": "ACC-01",
                                "issue": "Avoid 'click here' link text.",
                                "suggestion": "Use descriptive link text.",
                            },
                            {
                                "standard_id": "ACT-02",
                                "issue": "Vague verb.",
                                "suggestion": "Use a specific verb.",
                            },
                        ],
                    }
                    for _ in range(4)
                ],
            )
        )
    md = render_markdown(reports, total_strings=1200)
    assert len(md) < 65536, f"comment body is {len(md)} chars, GitHub rejects over 65536"
    assert len(md) <= MAX_COMMENT_CHARS + 1000  # small slack for footer
    assert "Comment truncated" in md
