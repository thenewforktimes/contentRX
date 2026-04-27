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


def test_substrate_fields_never_appear_in_rendered_output() -> None:
    """Audit 2026-04-26 fence — guarantee no substrate field name leaks
    onto the public PR-comment surface.

    The schema 2.0.0 contract is: PR comments render only `issue`,
    `suggestion`, `severity` (the public envelope shape). The internal
    fields `standard_id`, `rule_version`, `related_standards`,
    `rationale_chain`, `docs_url`, `ambiguity_flag`,
    `validate_rejection_reason`, `source` must never appear in the
    Markdown body — neither as field names nor as keys/values.

    This test feeds the renderer a kitchen-sink violation that includes
    every substrate field, then scans the output for each field name.
    A future regression that adds e.g. `**Standard:** ACC-01` to the
    output blows up here loudly instead of slipping past triage.
    """
    substrate = {
        "standard_id": "PRF-11",
        "rule_version": "1.4.0",
        "rule": "Substrate-only rule text",
        "related_standards": ["ACC-01", "GRM-01"],
        "rationale_chain": [{"step": 1, "decision": "fired"}],
        "docs_url": "https://example.invalid/standards/PRF-11",
        "ambiguity_flag": None,
        "validate_rejection_reason": None,
        "source": "llm",
        # Public fields the renderer is allowed to surface.
        "issue": "Avoid jargon in error copy.",
        "suggestion": "Rephrase in plain language.",
        "severity": "high",
    }
    reports = [
        _report(
            "src/Comp.tsx",
            [
                {
                    "text": "Authentication terminated due to session timeout.",
                    "line": 17,
                    "kind": "jsx-text",
                    "violations": [substrate],
                }
            ],
        ),
    ]
    md = render_markdown(reports, total_strings=1)

    # Public fields must reach the comment.
    assert "Avoid jargon in error copy." in md
    assert "Rephrase in plain language." in md

    # Substrate field NAMES must never appear in the rendered output.
    forbidden_names = (
        "standard_id",
        "rule_version",
        "related_standards",
        "rationale_chain",
        "docs_url",
        "ambiguity_flag",
        "validate_rejection_reason",
    )
    for name in forbidden_names:
        assert name not in md, (
            f"substrate field name {name!r} leaked into PR-comment markdown"
        )

    # Substrate VALUES that would identify the private taxonomy must
    # also be absent. PRF-11 is the standard_id, ACC-01/GRM-01 are
    # related_standards values.
    assert "PRF-11" not in md
    assert "1.4.0" not in md  # rule_version
    assert "https://example.invalid" not in md  # docs_url


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


# ---------------------------------------------------------------------------
# PR-14 — max-checks cap notice
# ---------------------------------------------------------------------------
def test_truncated_count_renders_notice_when_no_violations() -> None:
    md = render_markdown([], total_strings=200, truncated_count=287)
    assert "200" in md
    assert "287" in md
    assert "max-checks" in md
    # Total = 200 + 287 = 487
    assert "487" in md


def test_truncated_count_renders_notice_with_violations() -> None:
    reports = [
        _report(
            "src/Demo.tsx",
            [
                {
                    "text": "Click here",
                    "line": 5,
                    "kind": "jsx-text",
                    "violations": [
                        {
                            "issue": "Generic CTA.",
                            "suggestion": "Use a specific verb.",
                            "severity": "high",
                        }
                    ],
                }
            ],
        )
    ]
    md = render_markdown(reports, total_strings=200, truncated_count=50)
    assert "max-checks" in md
    assert "Generic CTA" in md
    assert "50" in md


def test_truncated_count_zero_omits_notice() -> None:
    md = render_markdown([], total_strings=10, truncated_count=0)
    assert "max-checks" not in md


def test_truncated_count_negative_omits_notice() -> None:
    """Defensive: negative truncation makes no sense; treat as 0."""
    md = render_markdown([], total_strings=10, truncated_count=-5)
    assert "max-checks" not in md
