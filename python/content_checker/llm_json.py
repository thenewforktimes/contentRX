"""Shared helpers for parsing JSON from Claude responses.

Claude occasionally wraps JSON output in a markdown code fence
(```json ... ``` or ``` ... ```) despite the "no markdown, no backticks"
instruction in the system prompt. These helpers strip the fence if present
and parse the JSON, returning None on any failure so callers can choose
their own fallback behavior.
"""

from __future__ import annotations

import json


def strip_code_fence(raw: str) -> str:
    """Strip a markdown code fence wrapper from an LLM response, if present.

    Handles ```json\n{...}\n``` and ```\n{...}\n``` forms. If the response is
    not wrapped in a code fence, the input is returned unchanged (trimmed).
    """
    text = raw.strip()
    if text.startswith("```"):
        newline_idx = text.find("\n")
        text = text[newline_idx + 1:] if newline_idx != -1 else text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


def parse_llm_json(raw: str) -> dict | None:
    """Parse JSON from an LLM response, tolerating a markdown code fence wrapper.

    Returns the parsed object on success, or None if the response is not valid
    JSON. Callers decide what fallback behavior to apply on None.
    """
    try:
        return json.loads(strip_code_fence(raw))
    except json.JSONDecodeError:
        return None
