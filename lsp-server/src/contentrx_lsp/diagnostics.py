"""Convert ContentRX `/api/check` results into LSP diagnostics.

Separated from the server + client so the mapping logic is pure and
unit-testable. No pygls imports here — we return a typed record the
server layer converts into `lsprotocol.types.Diagnostic` at emit time.
Lets tests run without a full LSP dependency graph.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .parser import ExtractedString


@dataclass(frozen=True)
class LspRange:
    start_line: int
    start_char: int
    end_line: int
    end_char: int


@dataclass(frozen=True)
class LspDiagnostic:
    """The LSP-facing shape of a violation.

    `severity` uses LSP's 1-based scale: 1=error, 2=warning, 3=info,
    4=hint. ContentRX verdicts map as:
      - violation       → 2 (warning)
      - review_recommended → 3 (info)
      - pass / anything else → no diagnostic

    A `violation` is a build-breaker in CI mode but doesn't rise to
    TypeScript-error urgency inline while typing, hence warning.
    `review_recommended` maps to info so the editor's problems panel
    distinguishes the two visually.
    """

    range: LspRange
    severity: int
    code: str  # standard_id
    source: str  # "ContentRX"
    message: str
    data: dict[str, Any]  # carries the raw violation for code actions


_STANDARDS_URL_BASE = "https://docs.contentrx.io/model/standards"


def byte_range_to_lsp_range(
    source: str, start_byte: int, end_byte: int
) -> LspRange:
    """Translate a [start_byte, end_byte) range into an LSP Range.

    LSP ranges are `{line, character}` with line and character both
    0-based. Character offsets count UTF-16 code units per the spec,
    not UTF-8 bytes. For ASCII source (the common case in TSX) these
    coincide; for source with non-BMP characters or multi-byte UTF-8
    sequences we convert correctly.

    The LSP client tolerates slightly off ranges (it'll just
    underline the wrong spot) but the cleanest story is to be exact.
    """
    start_line, start_char = _byte_to_line_char(source, start_byte)
    end_line, end_char = _byte_to_line_char(source, end_byte)
    return LspRange(
        start_line=start_line,
        start_char=start_char,
        end_line=end_line,
        end_char=end_char,
    )


def _byte_to_line_char(source: str, byte_offset: int) -> tuple[int, int]:
    """Convert a UTF-8 byte offset into the (line, char-UTF16-code-unit) pair
    LSP expects.

    Implementation: decode the prefix of `source` up to `byte_offset`,
    count newlines for line, then count UTF-16 code units in the last
    line. For the LSP surface, UTF-16 code units is what
    `PositionEncodingKind.UTF16` (the default) means.
    """
    encoded = source.encode("utf-8")
    if byte_offset > len(encoded):
        byte_offset = len(encoded)
    prefix = encoded[:byte_offset].decode("utf-8", errors="replace")
    # Count newlines for line number.
    if "\n" in prefix:
        last_nl = prefix.rfind("\n")
        line = prefix.count("\n")
        after_nl = prefix[last_nl + 1 :]
    else:
        line = 0
        after_nl = prefix
    # UTF-16 code-unit count of the suffix after the last newline.
    char = len(after_nl.encode("utf-16-le")) // 2
    return line, char


def violations_to_diagnostics(
    source: str,
    extracted: ExtractedString,
    violations: list[dict[str, Any]],
    *,
    verdict: str,
    review_reason: str | None = None,
) -> list[LspDiagnostic]:
    """One violation → one diagnostic, scoped to the extracted string's range.

    When `verdict == "review_recommended"` with no violations, we
    still want to surface the uncertainty to the reviewer — emit one
    `info`-severity diagnostic naming the review_reason.
    """
    out: list[LspDiagnostic] = []
    lsp_range = byte_range_to_lsp_range(
        source, extracted.start_byte, extracted.end_byte
    )

    if violations:
        # Schema 2.0.0 (ADR 2026-04-25): only public Violation fields
        # surface in the LSP message. `code` is now severity-derived,
        # not `standard_id` — the rule taxonomy is private. `data` no
        # longer carries `standard_id`, `rule`, or `docs_url`; the
        # apply-suggestion command operates on `suggestion` + byte
        # offsets alone.
        lsp_severity = 2 if verdict == "violation" else 3
        for v in violations:
            issue = v.get("issue") or ""
            suggestion = v.get("suggestion") or ""
            sev_band = v.get("severity") or "medium"
            message_parts: list[str] = []
            if issue:
                message_parts.append(issue)
            if suggestion:
                message_parts.append(f"Try: {suggestion}")
            message = " ".join(message_parts).strip() or "ContentRX flagged this string."
            out.append(
                LspDiagnostic(
                    range=lsp_range,
                    severity=lsp_severity,
                    code=sev_band.upper(),
                    source="ContentRX",
                    message=message,
                    data={
                        "issue": issue,
                        "suggestion": suggestion,
                        "severity": sev_band,
                        "extracted_text": extracted.text,
                        # Original byte offsets so the apply-suggestion
                        # command can use them directly instead of
                        # re-locating via source.find(). Closes audit
                        # M-27 — the find() approach silently overwrote
                        # the wrong copy when the same text appeared in
                        # multiple JSX nodes.
                        "start_byte": extracted.start_byte,
                        "end_byte": extracted.end_byte,
                    },
                )
            )
    elif verdict == "review_recommended":
        reason = review_reason or "review_recommended"
        pretty = reason.replace("_", " ")
        out.append(
            LspDiagnostic(
                range=lsp_range,
                severity=3,
                code="REVIEW",
                source="ContentRX",
                message=(
                    f"ContentRX flagged this for review ({pretty})."
                ),
                data={
                    "review_reason": reason,
                    "extracted_text": extracted.text,
                },
            )
        )

    return out
