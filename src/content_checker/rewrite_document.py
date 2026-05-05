"""Holistic document rewrite — produces a clean version of a long input.

The Document-tier dashboard surface (and the future MCP/CLI document
review modes) ask for a single rewritten version of the user's input
*as a whole*, not a list of per-finding patches. This is the
named-expert moat made visible: a content designer reviewed your doc
and gave you back a cleaner version. Findings remain a separate,
parallel signal — "here's what changed and why."

Output contract (schema 2.4.0): `{rewritten, diagnostic}`. The
rewritten text is the primary artifact; the diagnostic is a one-
sentence judgment of what's broadly wrong with the document, used by
the Document-tier verdict header to give the customer the
"should I bother?" answer in two seconds without scanning every
finding. Same LLM call produces both — diagnostic adds ~30 output
tokens.

Scope decision (mirrors suggest_fix): the rewriter applies the
standards as a *coherent voice*, not as a checklist. We don't pass
the violation list as input — the LLM works from the standards prompt
and the input alone. This keeps the rewrite from over-fitting to a
mechanical "fix item 1, fix item 2" pass.

Triggered conservatively: /api/check only calls this for tier="document"
AND when the regular check found something worth rewriting. Clean docs
don't get a rewrite — there's nothing to fix.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from content_checker.api_utils import (
    DEFAULT_MODEL,
    LLMResponse,
    ParseError,
    TIMEOUT_SCAN,
    create_message,
    parse_llm_json,
    wrap_user_text,
)


# Document rewrites can be 5K chars in, 5K chars out. 4096 max_tokens
# is the engine default and sufficient: even at the upper bound of
# MAX_INPUT_CHARS (50K), most rewrites compress to fit within the
# token cap because the standards prefer shorter copy.
_MAX_TOKENS = 4096


@dataclass(frozen=True)
class RewriteDocumentResult:
    rewritten: str
    diagnostic: str
    latency_ms: int
    input_tokens: int
    output_tokens: int
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0


def rewrite_document(
    *,
    text: str,
    model: str = DEFAULT_MODEL,
) -> RewriteDocumentResult:
    """Rewrite `text` as a coherent document in the ContentRX house voice.

    Returns `{rewritten, diagnostic}` plus token usage so the caller
    can bill the second LLM call to the same usage event.

    Failure mode: if the LLM's JSON output can't be parsed, fall back
    to treating the raw response as the rewrite with an empty
    diagnostic. This preserves the v2.3.0 behavior — a partial answer
    is better than no answer for a best-effort field.
    """
    system = _build_system_prompt()
    user = _build_user_prompt(text=text)

    started = time.perf_counter()
    response: LLMResponse = create_message(
        system=system,
        user=user,
        model=model,
        max_tokens=_MAX_TOKENS,
        timeout=TIMEOUT_SCAN,
    )
    elapsed_ms = int((time.perf_counter() - started) * 1000)

    rewritten, diagnostic = _parse_response(response.text)

    return RewriteDocumentResult(
        rewritten=rewritten,
        diagnostic=diagnostic,
        latency_ms=elapsed_ms,
        input_tokens=response.input_tokens,
        output_tokens=response.output_tokens,
        cache_creation_input_tokens=response.cache_creation_input_tokens,
        cache_read_input_tokens=response.cache_read_input_tokens,
    )


def _parse_response(raw: str) -> tuple[str, str]:
    """Extract `(rewritten, diagnostic)` from the LLM response.

    Soft-fail on parse error: return the raw text as the rewrite with
    an empty diagnostic. The diagnostic is best-effort UX polish, not
    a load-bearing field — its absence shouldn't drop the rewrite.
    """
    try:
        parsed = parse_llm_json(raw, context="rewrite_document")
        rewritten = parsed.get("rewritten")
        diagnostic = parsed.get("diagnostic")
        if not isinstance(rewritten, str) or not rewritten.strip():
            raise ParseError(
                "rewrite_document: missing or empty `rewritten`",
                raw=raw,
                context="rewrite_document",
            )
        if not isinstance(diagnostic, str):
            diagnostic = ""
        return rewritten.strip(), diagnostic.strip()
    except ParseError:
        # Soft-fail: ship the raw text as the rewrite, drop the diagnostic.
        return raw.strip(), ""


def _build_system_prompt() -> str:
    return (
        "You are ContentRX, a staff content designer reviewing a "
        "customer's document. Your job is ONE thing: rewrite the "
        "customer's document in the ContentRX house voice. Nothing "
        "else.\n\n"
        "## Voice\n\n"
        "Calm, confident, charming. Direct. Names the actor. Doesn't "
        "blame the user. Points somewhere.\n\n"
        "## Hard rules for the rewrite\n\n"
        "- **No em dashes or en dashes.** Use periods, commas, colons, "
        "parens, or sentence breaks.\n"
        "- **Short sentences.** Aim for 15–20 words; sentences over 25 "
        "words almost always split.\n"
        "- **Plain language.** Reach for the shorter word. Cut "
        "corporate jargon (\"synergy\", \"leverage\", \"optimize\", "
        "\"circle back\", \"deep dive\", etc.). Cut hedging filler "
        "(\"please feel free to\", \"if you need anything\", \"to "
        "learn more\", \"for assistance\"). Cut breezy AI-assistant "
        "tone (\"don't worry\", \"great news\", \"rest assured\").\n"
        "- **Use common contractions** in conversational copy. Spell "
        "them out only in legal/regulatory contexts or where emphasis "
        "demands it.\n"
        "- **Sentence case for headings**, not title case. Keep proper "
        "nouns and acronyms as they are.\n"
        "- **Lead with the benefit** in instructional copy. \"To add a "
        "customer, go to the Customers tab\" beats \"Go to the "
        "Customers tab to add a customer.\" Buttons start with verbs "
        "regardless.\n"
        "- **Active voice.** Say what happened or what to do, plainly.\n"
        "- **AP-style hyphenation.** \"Brick-by-brick\" reads well; "
        "\"highly-anticipated\" and \"pre-existing\" do not.\n\n"
        "## Output rules\n\n"
        "- Preserve the structure of the original — same paragraphs, "
        "same headings, same lists. Don't reorganize.\n"
        "- Keep approximately the same length, or shorter. Plain "
        "language usually compresses; that's fine. Don't expand.\n"
        "- If the original is already clean and follows the voice "
        "above, return it largely unchanged. Don't 'improve' for the "
        "sake of changing.\n"
        "- Preserve all factual content (numbers, names, dates, "
        "specifics). Tone and structure change; facts don't.\n\n"
        "## Response format\n\n"
        "Respond with a single JSON object — no markdown code fences, "
        "no preface, no surrounding text. Two fields:\n\n"
        "  {\n"
        '    "rewritten": "the full rewritten document, with original '
        'paragraph breaks preserved as \\n\\n",\n'
        '    "diagnostic": "one short sentence (under 20 words) '
        'naming the document\'s broad weaknesses — e.g. \\"Heavy '
        'jargon, several long sentences, idiom-rich.\\" Used as a '
        'two-second judgment in the verdict header. If the document '
        "is already clean, say so plainly.\"\n"
        "  }\n\n"
        "Both fields are required. The diagnostic is plain English; "
        "no severity scores, no counts, no list of specific findings — "
        "those are surfaced separately."
    )


def _build_user_prompt(*, text: str) -> str:
    return "\n".join([
        "Document to rewrite:",
        wrap_user_text(text),
    ])
