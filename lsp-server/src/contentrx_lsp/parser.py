"""JSX/TSX string extraction via tree-sitter.

Walks a source document's syntax tree and emits `ExtractedString`
records for every piece of text that looks like UI copy — JSX text
content and stringy JSX attribute values. Each extracted string
carries its byte range in the document so the diagnostics layer can
map violations back to LSP `Range` objects.

Scope decision: we limit to JSX (text children + attribute strings)
rather than every `"..."` literal anywhere in the file. Random string
constants in source code are mostly not UI copy, and false-positive
diagnostics on them would be noisy. The VS Code extension can grow
"lint all strings" as a per-project opt-in if users want it later.

The tree-sitter-typescript package provides both `language_typescript`
and `language_tsx`. We always parse as TSX — it's a superset that
handles plain `.ts` just fine (JSX nodes simply never appear).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import tree_sitter_typescript
from tree_sitter import Language, Parser


# Attributes that carry UI copy. Others (id, className, href, type)
# overwhelmingly do not. This list keeps signal high without being
# exhaustive — if a project uses a custom prop that carries copy, the
# user can always run the MCP tool or CLI on the string directly.
_COPY_ATTRS: frozenset[str] = frozenset(
    {
        "alt",
        "aria-label",
        "aria-description",
        "aria-placeholder",
        "label",
        "placeholder",
        "title",
        "tooltip",
        "description",
    }
)


@dataclass(frozen=True)
class ExtractedString:
    """A piece of UI copy pulled out of a TSX document.

    `text` is the raw string with surrounding whitespace trimmed
    (but internal whitespace preserved). `start_byte` / `end_byte`
    point at the original source range so the diagnostics layer can
    map back to an LSP `Range`.
    """

    text: str
    start_byte: int
    end_byte: int
    kind: str  # "jsx_text" | "jsx_attribute"
    attribute_name: str | None = None


_TSX_LANGUAGE = Language(tree_sitter_typescript.language_tsx())


def _make_parser() -> Parser:
    parser = Parser(_TSX_LANGUAGE)
    return parser


# Module-level parser — tree-sitter parsers are cheap to reuse and
# thread-safe for non-incremental parsing. The LSP server runs single-
# threaded, so sharing one is fine.
_PARSER = _make_parser()


def extract_strings(source: str) -> list[ExtractedString]:
    """Return every UI-copy string found in a TSX source document.

    Never raises on malformed input — tree-sitter produces an error
    node tree for invalid syntax and we simply return whatever well-
    formed strings we found. Editors frequently hand us mid-edit
    documents, so degrading gracefully matters.
    """
    source_bytes = source.encode("utf-8")
    tree = _PARSER.parse(source_bytes)
    out: list[ExtractedString] = []
    _walk(tree.root_node, source_bytes, out)
    return out


def _walk(node, source_bytes: bytes, out: list[ExtractedString]) -> None:
    """Recurse the tree, emitting ExtractedString for matching nodes."""
    for child in node.children:
        node_type = child.type

        if node_type == "jsx_text":
            raw = source_bytes[child.start_byte : child.end_byte].decode(
                "utf-8", errors="replace"
            )
            trimmed = raw.strip()
            if trimmed:
                # Shift the start/end bytes to point at the trimmed
                # content only, so diagnostic ranges don't highlight
                # whitespace/newlines around the text.
                leading_ws = len(raw) - len(raw.lstrip())
                trailing_ws = len(raw) - len(raw.rstrip())
                out.append(
                    ExtractedString(
                        text=trimmed,
                        start_byte=child.start_byte + leading_ws,
                        end_byte=child.end_byte - trailing_ws,
                        kind="jsx_text",
                    )
                )

        elif node_type == "jsx_attribute":
            # tree-sitter-typescript doesn't expose named fields on
            # jsx_attribute — use positional children. The grammar is:
            #   jsx_attribute := property_identifier ("=" attribute_value)?
            name_node = None
            value_node = None
            for gc in child.children:
                if gc.type in ("property_identifier", "jsx_namespace_name"):
                    name_node = gc
                elif gc.type in (
                    "string",
                    "jsx_expression",
                    "number",
                    "true",
                    "false",
                ):
                    value_node = gc
            if name_node is None or value_node is None:
                continue
            attr_name = source_bytes[
                name_node.start_byte : name_node.end_byte
            ].decode("utf-8", errors="replace")
            if attr_name not in _COPY_ATTRS:
                continue
            extracted = _extract_attribute_value(value_node, source_bytes)
            if extracted is None:
                continue
            text, start_byte, end_byte = extracted
            out.append(
                ExtractedString(
                    text=text,
                    start_byte=start_byte,
                    end_byte=end_byte,
                    kind="jsx_attribute",
                    attribute_name=attr_name,
                )
            )

        # Recurse into everything — jsx elements can nest inside
        # expression containers, conditional expressions, etc.
        if child.child_count > 0:
            _walk(child, source_bytes, out)


def _extract_attribute_value(
    value_node, source_bytes: bytes
) -> tuple[str, int, int] | None:
    """Unwrap `"hello"` or `{\"hello\"}` → ("hello", start_byte, end_byte).

    Returns None for non-string attribute values (JSX expressions that
    aren't string literals, numbers, booleans). Those are either
    dynamic values we can't lint safely or not UI copy at all.
    """
    # Case 1: plain string attribute (`alt="hello"`).
    if value_node.type == "string":
        raw = source_bytes[
            value_node.start_byte : value_node.end_byte
        ].decode("utf-8", errors="replace")
        # Strip the quotes but keep the inner bytes range.
        if len(raw) >= 2 and raw[0] in ("'", '"') and raw[-1] in ("'", '"'):
            inner = raw[1:-1]
            return (
                inner,
                value_node.start_byte + 1,
                value_node.end_byte - 1,
            )
        return (raw, value_node.start_byte, value_node.end_byte)

    # Case 2: JSX expression container wrapping a single string
    # literal (`alt={"hello"}`). We treat `{'hi'}` and `{"hi"}` the
    # same way for content-check purposes.
    if value_node.type == "jsx_expression":
        for gchild in value_node.children:
            if gchild.type == "string":
                return _extract_attribute_value(gchild, source_bytes)
    return None
