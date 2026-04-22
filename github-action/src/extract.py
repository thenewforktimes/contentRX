"""Regex-based string extraction for JSX / TSX / HTML.

This is deliberately a v1 extractor — regex, not AST. BUILD_PLAN §15
upgrades to a proper TypeScript AST walk later. For v1 we want to
cover enough to be useful without turning into a TS compiler
shipped in a Docker image.

Two kinds of string land in `extract_strings`:

1. **JSXText** — the text node between tags.
   `<h1>Welcome back</h1>` → `"Welcome back"`

2. **String-literal attributes** — specific attrs where the value is
   almost always UI copy.
   `<img alt="User avatar">` → `"User avatar"`
   `<input placeholder="Enter your email">` → `"Enter your email"`

We skip anything that looks dynamic (template literals, interpolations,
identifiers). We skip strings that are too short to be meaningful
(< 2 characters), all-punctuation, or purely numeric — reduces noise
without missing legitimate copy.

Any false positives here become false-positive violations later. Worse
than too-permissive is too-strict; the downstream check is still the
content checker, which has its own guardrails.
"""

from __future__ import annotations

import fnmatch
import re
from dataclasses import dataclass
from pathlib import Path


# Attributes that almost always hold user-facing copy. If an attribute
# is missing from this list, we skip its string value. Favor precision
# over recall for v1 — false positives are a worse UX than missed strings.
COPY_ATTRIBUTES = frozenset(
    {
        "alt",
        "aria-label",
        "arialabel",  # some codebases drop the hyphen
        "label",
        "placeholder",
        "title",
        "description",
        "tooltip",
        "subtitle",
        "heading",
        "text",
        "message",
        "content",
    }
)

# Tags whose inner text is almost never user-facing — skip their JSXText.
SKIP_INNER_TEXT_TAGS = frozenset({"script", "style", "noscript", "code", "pre"})


_ATTR_RE = re.compile(
    r"""
    \b(?P<attr>[a-zA-Z][a-zA-Z0-9_-]*)   # attribute name
    \s*=\s*
    "(?P<value>[^"]*)"                    # double-quoted value only;
                                          # single-quoted is also valid HTML
                                          # but is handled separately to
                                          # keep the regex readable
    """,
    re.VERBOSE,
)

_ATTR_RE_SINGLE = re.compile(
    r"\b(?P<attr>[a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*'(?P<value>[^']*)'"
)

# Very loose JSX element tokenizer: grab the tag open, the attrs span,
# and the text immediately after. Multi-line-friendly. Not a parser.
_JSX_TEXT_RE = re.compile(
    r"<(?P<tag>[A-Za-z][A-Za-z0-9_.-]*)\b[^>]*>(?P<text>[^<]+?)</",
    re.DOTALL,
)


@dataclass(frozen=True)
class Extraction:
    """One string pulled from source. `kind` distinguishes how it was found."""

    text: str
    source_file: str
    line: int
    kind: str  # "jsx-text" or "attr:<name>"


def extract_strings(path: Path, source: str | None = None) -> list[Extraction]:
    """Pull all UI-copy candidates from a single source file."""
    source = source if source is not None else path.read_text(encoding="utf-8")
    hits: list[Extraction] = []

    # ------------------------------------------------------------------
    # Pass 1: JSX / HTML text nodes.
    # ------------------------------------------------------------------
    for match in _JSX_TEXT_RE.finditer(source):
        tag = match.group("tag").lower()
        if tag in SKIP_INNER_TEXT_TAGS:
            continue
        raw_text = match.group("text")
        for piece in _split_and_clean(raw_text):
            if not _looks_like_copy(piece):
                continue
            line = source.count("\n", 0, match.start("text")) + 1
            hits.append(
                Extraction(text=piece, source_file=str(path), line=line, kind="jsx-text")
            )

    # ------------------------------------------------------------------
    # Pass 2: attribute values. Both quote styles.
    # ------------------------------------------------------------------
    for regex in (_ATTR_RE, _ATTR_RE_SINGLE):
        for match in regex.finditer(source):
            attr = match.group("attr").lower()
            if attr not in COPY_ATTRIBUTES:
                continue
            value = match.group("value")
            if not _looks_like_copy(value):
                continue
            if _looks_dynamic(value):
                continue
            line = source.count("\n", 0, match.start("value")) + 1
            hits.append(
                Extraction(
                    text=value,
                    source_file=str(path),
                    line=line,
                    kind=f"attr:{attr}",
                )
            )

    return _dedupe(hits)


def matches_glob(path: str, pattern: str) -> bool:
    """Glob match with brace expansion (**/*.{tsx,jsx,html}).

    Python's fnmatch doesn't do `{a,b,c}`, so we expand manually and
    OR the results together.
    """
    for expanded in _expand_braces(pattern):
        if fnmatch.fnmatch(path, expanded):
            return True
    return False


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------
def _split_and_clean(raw: str) -> list[str]:
    """Collapse whitespace; return a single trimmed string per JSXText node."""
    cleaned = re.sub(r"\s+", " ", raw).strip()
    if not cleaned:
        return []
    return [cleaned]


def _looks_like_copy(text: str) -> bool:
    """Heuristic: is this string likely user-visible UI copy?

    Reject:
      - too short (< 2 chars)
      - all digits / all punctuation
      - starts with `{` or `$` (interpolation leftover)
      - contains backtick (template literal)
      - a single word that looks like an identifier (camelCase/snake_case)
    """
    if len(text) < 2:
        return False
    if text.strip().startswith("{"):
        return False
    if "`" in text or "${" in text:
        return False
    if not re.search(r"[A-Za-z]", text):
        return False
    if " " not in text and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", text):
        # single identifier-looking token — likely a variable reference
        return False
    if re.fullmatch(r"[\s\d\W_]+", text):
        return False
    return True


def _looks_dynamic(value: str) -> bool:
    # Catches things like title="Welcome, ${user.name}" that squeaked
    # past the attribute regex because the $ is inside the quotes.
    return "${" in value or "{{" in value


def _dedupe(hits: list[Extraction]) -> list[Extraction]:
    """Keep the first occurrence of each (file, line, text) — regexes
    sometimes double-match near attribute/text boundaries."""
    seen = set()
    out = []
    for h in hits:
        key = (h.source_file, h.line, h.text, h.kind)
        if key in seen:
            continue
        seen.add(key)
        out.append(h)
    return out


def _expand_braces(pattern: str) -> list[str]:
    """`a{b,c}d` → `['abd', 'acd']`. Only handles one level of braces,
    which is all BUILD_PLAN §12's default pattern needs."""
    match = re.search(r"\{([^{}]+)\}", pattern)
    if not match:
        return [pattern]
    alternatives = match.group(1).split(",")
    prefix = pattern[: match.start()]
    suffix = pattern[match.end() :]
    return [prefix + alt + suffix for alt in alternatives]
