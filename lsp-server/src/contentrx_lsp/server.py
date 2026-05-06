"""ContentRX LSP server entry point.

Registers with pygls and handles the lifecycle events the spec
demands (initialize, didOpen, didChange, publishDiagnostics). Every
string extracted from a TSX document gets a concurrent `/api/check`
call; results land back as diagnostics via `publishDiagnostics`.

Per-document rate limiting: a token bucket allows 2 checks per second
per document. Edits that arrive faster than that coalesce — only the
most recent text gets linted.

Debouncing: didChange fires on every keystroke. We wait 400ms after
the last edit before starting any checks, so rapid typing doesn't
spawn a burst of API calls that would all be invalidated by the next
keystroke anyway.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any

from lsprotocol import types as lsp
from pygls.lsp.server import LanguageServer

from . import __version__
from .auth import AuthError, get_api_base_url, get_api_key
from .client import (
    AuthFailedError,
    ContentRXError,
    QuotaExhaustedError,
    RateLimitError,
    check,
    suggest_fix,
)
from .code_actions import (
    CMD_APPLY_SUGGESTION,
    plan_actions_for_diagnostic,
    plan_to_code_action,
)
from .diagnostics import LspDiagnostic, violations_to_diagnostics
from .parser import extract_strings


log = logging.getLogger("contentrx-lsp")


# Per-document tuning. Public constants so tests can patch them.
DEBOUNCE_SECONDS = 0.4
RATE_LIMIT_PER_SECOND = 2
MAX_STRINGS_PER_DOCUMENT = 50
# Boundary guards — tree-sitter handles arbitrary input but a 50 MB
# minified bundle or a binary file pasted into a TSX buffer would
# stall lint with no benefit. Both cases skip silently.
MAX_DOCUMENT_BYTES = 1_000_000  # 1 MB
_BINARY_SNIFF_BYTES = 4096


@dataclass
class DocumentState:
    """Per-document bookkeeping the server keeps."""

    text: str = ""
    version: int = 0
    last_edit_ts: float = 0.0
    pending_task: asyncio.Task[None] | None = None
    # Token bucket: `tokens` is the current pool; we top it up at
    # `RATE_LIMIT_PER_SECOND` per second up to a ceiling.
    tokens: float = float(RATE_LIMIT_PER_SECOND)
    last_refill_ts: float = 0.0

    def refill(self, now: float) -> None:
        if self.last_refill_ts == 0.0:
            self.last_refill_ts = now
            return
        delta = now - self.last_refill_ts
        self.tokens = min(
            float(RATE_LIMIT_PER_SECOND),
            self.tokens + delta * RATE_LIMIT_PER_SECOND,
        )
        self.last_refill_ts = now

    def try_take(self, now: float) -> bool:
        self.refill(now)
        if self.tokens >= 1.0:
            self.tokens -= 1.0
            return True
        return False


class ContentRXLanguageServer(LanguageServer):
    """Thin pygls subclass keeping per-document state."""

    def __init__(self) -> None:
        super().__init__("contentrx-lsp", __version__)
        self.documents: dict[str, DocumentState] = {}
        self._startup_warning_sent = False


SERVER = ContentRXLanguageServer()


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------


@SERVER.feature(lsp.INITIALIZE)
def _initialize(
    server: ContentRXLanguageServer, params: lsp.InitializeParams
) -> lsp.InitializeResult:
    """Handshake: advertise the capabilities we support."""
    return lsp.InitializeResult(
        capabilities=lsp.ServerCapabilities(
            text_document_sync=lsp.TextDocumentSyncOptions(
                open_close=True,
                change=lsp.TextDocumentSyncKind.Incremental,
            ),
            position_encoding=lsp.PositionEncodingKind.Utf16,
            code_action_provider=lsp.CodeActionOptions(
                code_action_kinds=[lsp.CodeActionKind.QuickFix],
                resolve_provider=False,
            ),
            execute_command_provider=lsp.ExecuteCommandOptions(
                commands=[CMD_APPLY_SUGGESTION],
            ),
        ),
        server_info=lsp.InitializeResultServerInfoType(
            name="contentrx-lsp",
            version=__version__,
        ),
    )


@SERVER.feature(lsp.INITIALIZED)
def _initialized(
    server: ContentRXLanguageServer, _params: lsp.InitializedParams
) -> None:
    """Called after initialize. Surface auth errors now so the user
    sees them at startup, not on the first edit."""
    try:
        get_api_key()
        get_api_base_url()
    except AuthError as exc:
        if not server._startup_warning_sent:
            server._startup_warning_sent = True
            server.show_message(
                f"ContentRX: {exc}",
                lsp.MessageType.Warning,
            )


@SERVER.feature(lsp.TEXT_DOCUMENT_DID_OPEN)
async def _did_open(
    server: ContentRXLanguageServer,
    params: lsp.DidOpenTextDocumentParams,
) -> None:
    doc = params.text_document
    state = server.documents.setdefault(doc.uri, DocumentState())
    state.text = doc.text
    state.version = doc.version
    state.last_edit_ts = time.monotonic()
    _schedule_lint(server, doc.uri)


@SERVER.feature(lsp.TEXT_DOCUMENT_DID_CHANGE)
async def _did_change(
    server: ContentRXLanguageServer,
    params: lsp.DidChangeTextDocumentParams,
) -> None:
    uri = params.text_document.uri
    state = server.documents.setdefault(uri, DocumentState())
    # Incremental sync — pygls gives us the full text via the
    # workspace if we ask, but it's easiest to reconstruct here.
    doc = server.workspace.get_text_document(uri)
    state.text = doc.source
    state.version = params.text_document.version
    state.last_edit_ts = time.monotonic()
    _schedule_lint(server, uri)


@SERVER.feature(lsp.TEXT_DOCUMENT_DID_CLOSE)
def _did_close(
    server: ContentRXLanguageServer,
    params: lsp.DidCloseTextDocumentParams,
) -> None:
    uri = params.text_document.uri
    state = server.documents.pop(uri, None)
    if state and state.pending_task:
        state.pending_task.cancel()
    # Clear any lingering diagnostics on the closed file.
    server.publish_diagnostics(uri, [])


# ---------------------------------------------------------------------------
# Lint orchestration
# ---------------------------------------------------------------------------


def _schedule_lint(server: ContentRXLanguageServer, uri: str) -> None:
    state = server.documents.get(uri)
    if state is None:
        return
    # Cancel any in-flight lint so the debounce window restarts. The
    # task itself checks `last_edit_ts` before starting network calls
    # — if another edit arrives during the await, we bail.
    if state.pending_task and not state.pending_task.done():
        state.pending_task.cancel()
    state.pending_task = asyncio.create_task(_lint_after_debounce(server, uri))


async def _lint_after_debounce(
    server: ContentRXLanguageServer, uri: str
) -> None:
    try:
        await asyncio.sleep(DEBOUNCE_SECONDS)
    except asyncio.CancelledError:
        return

    state = server.documents.get(uri)
    if state is None:
        return

    # If another edit landed during the sleep, abort — the scheduler
    # will have queued a fresh lint on that newer edit.
    edit_ts = state.last_edit_ts
    await _lint_document(server, uri, state.text, edit_ts)


def _is_binary_blob(source: str) -> bool:
    """Heuristic: a NUL byte in the leading window means the buffer
    isn't valid TSX. Tree-sitter would still parse it, but the result
    is noise and can be slow on degenerate inputs."""
    return "\x00" in source[:_BINARY_SNIFF_BYTES]


async def _lint_document(
    server: ContentRXLanguageServer,
    uri: str,
    source: str,
    edit_ts: float,
) -> None:
    if len(source.encode("utf-8", errors="ignore")) > MAX_DOCUMENT_BYTES:
        # Oversize file — skip and clear any stale diagnostics so the
        # editor doesn't hang onto markings from the prior pass.
        server.publish_diagnostics(uri, [])
        return
    if _is_binary_blob(source):
        server.publish_diagnostics(uri, [])
        return
    extracted = extract_strings(source)[:MAX_STRINGS_PER_DOCUMENT]

    # De-duplicate identical strings — if the same copy appears in 5
    # buttons, we only need to check it once.
    seen_texts: dict[str, list[Any]] = {}
    for ex in extracted:
        seen_texts.setdefault(ex.text, []).append(ex)

    diagnostics: list[LspDiagnostic] = []

    for text, group in seen_texts.items():
        state = server.documents.get(uri)
        if state is None or state.last_edit_ts > edit_ts:
            # A newer edit invalidated this lint — drop what we have
            # and let the next debounce lint the fresh text.
            return

        now = time.monotonic()
        if not state.try_take(now):
            # Over rate limit. Wait a tick and loop — better to delay
            # a few checks than drop them silently.
            await asyncio.sleep(1.0 / RATE_LIMIT_PER_SECOND)
            if state.last_edit_ts > edit_ts:
                return

        try:
            result = await check(text)
        except (AuthFailedError, QuotaExhaustedError) as exc:
            server.show_message(
                f"ContentRX: {exc}", lsp.MessageType.Warning
            )
            return
        except RateLimitError as exc:
            log.info("Rate limit: %s", exc)
            await asyncio.sleep(exc.retry_after_seconds)
            continue
        except ContentRXError as exc:
            log.warning("ContentRX API error: %s", exc)
            continue

        if result.verdict not in ("violation", "review_recommended"):
            continue
        for ex in group:
            diagnostics.extend(
                violations_to_diagnostics(
                    source,
                    ex,
                    result.violations,
                    verdict=result.verdict,
                    review_reason=result.review_reason,
                )
            )

    server.publish_diagnostics(
        uri, [_to_lsp_diagnostic(d) for d in diagnostics]
    )


def _to_lsp_diagnostic(d: LspDiagnostic) -> lsp.Diagnostic:
    return lsp.Diagnostic(
        range=lsp.Range(
            start=lsp.Position(line=d.range.start_line, character=d.range.start_char),
            end=lsp.Position(line=d.range.end_line, character=d.range.end_char),
        ),
        severity=lsp.DiagnosticSeverity(d.severity),
        code=d.code,
        source=d.source,
        message=d.message,
        data=d.data,
    )


# ---------------------------------------------------------------------------
# Code actions (BUILD_PLAN_v2 Session 17)
# ---------------------------------------------------------------------------


@SERVER.feature(lsp.TEXT_DOCUMENT_CODE_ACTION)
def _code_actions(
    server: ContentRXLanguageServer, params: lsp.CodeActionParams
) -> list[lsp.CodeAction]:
    """Surface Quick Fix actions for every ContentRX diagnostic in range.

    The editor calls this every time the cursor lands on a diagnostic.
    We respond with the three actions per diagnostic (rewrite, show
    rationale, mark false positive). No LLM call happens here — the
    user invokes one of these from the lightbulb menu, which
    triggers `workspace/executeCommand` (handled below).
    """
    out: list[lsp.CodeAction] = []
    for diagnostic in params.context.diagnostics:
        if diagnostic.source != "ContentRX":
            continue
        data = diagnostic.data if isinstance(diagnostic.data, dict) else {}
        for plan in plan_actions_for_diagnostic(
            data, params.text_document.uri
        ):
            out.append(plan_to_code_action(plan, diagnostic))
    return out


@SERVER.command(CMD_APPLY_SUGGESTION)
async def _apply_suggestion(
    server: ContentRXLanguageServer, args: list[dict[str, Any]]
) -> None:
    """Call /api/suggest-fix and apply the rewrite as a WorkspaceEdit.

    Schema 2.0.0 LSP diagnostics don't carry `standard_id`, so the
    rewriter anchors on `issue` + `current_suggestion` (or `rule` for
    team-custom rules). We need at least ONE of those to bother
    invoking the API; an empty payload would just round-trip the input.
    """
    if not args:
        return
    payload = args[0]
    uri = payload.get("uri")
    text = payload.get("text") or ""
    if not uri or not text:
        return
    issue = payload.get("issue") or ""
    current_suggestion = payload.get("current_suggestion") or ""
    rule = payload.get("rule") or ""
    if not (issue or current_suggestion or rule):
        server.show_message(
            "ContentRX: nothing to anchor a rewrite on — "
            "no issue or suggestion attached to this diagnostic.",
            lsp.MessageType.Info,
        )
        return

    # Find the exact range of `text` in the live document. The client
    # calls this on the current document state; we re-extract strings
    # and locate the first match whose content equals `text`.
    doc = server.workspace.get_text_document(uri)
    source = doc.source
    state = server.documents.get(uri)
    if state:
        # Prefer the server's cached text to stay consistent with the
        # diagnostic that triggered the action.
        source = state.text

    # Prefer the original byte offsets threaded through from the
    # diagnostic that triggered this action — they pin to the exact
    # JSX node that fired. The source.find() fallback is for older
    # diagnostics emitted before audit M-27 (or for callers that don't
    # supply offsets), and accepts the first-occurrence trade-off.
    start_byte = payload.get("start_byte")
    end_byte = payload.get("end_byte")
    if isinstance(start_byte, int) and isinstance(end_byte, int):
        range_obj = _byte_range_to_lsp_range(source, start_byte, end_byte)
    else:
        range_obj = _find_range_for_text(source, text)

    if range_obj is None:
        server.show_message(
            "ContentRX: couldn't locate the original text for rewrite — "
            "the document changed under us.",
            lsp.MessageType.Info,
        )
        return

    try:
        result = await suggest_fix(
            text=text,
            rule=rule or None,
            issue=issue or None,
            current_suggestion=current_suggestion or None,
        )
    except (AuthFailedError, QuotaExhaustedError) as exc:
        server.show_message(f"ContentRX: {exc}", lsp.MessageType.Warning)
        return
    except ContentRXError as exc:
        server.show_message(
            f"ContentRX: suggestion failed — {exc}",
            lsp.MessageType.Warning,
        )
        return

    if not result.rewritten:
        server.show_message(
            "ContentRX: the rewriter returned an empty response.",
            lsp.MessageType.Warning,
        )
        return

    edit = lsp.WorkspaceEdit(
        changes={
            uri: [
                lsp.TextEdit(
                    range=range_obj,
                    new_text=result.rewritten,
                )
            ]
        }
    )
    server.apply_edit(edit)


def _byte_range_to_lsp_range(
    source: str, start_byte: int, end_byte: int,
) -> lsp.Range | None:
    """Translate a [start_byte, end_byte) range into an LSP Range.

    Preferred path when the caller knows the exact byte offsets that
    fired the diagnostic (audit M-27). Returns None if the bytes fall
    outside the current document — likely a stale diagnostic from
    before an edit.
    """
    if start_byte < 0 or end_byte < start_byte:
        return None
    source_bytes_len = len(source.encode("utf-8"))
    if end_byte > source_bytes_len:
        return None
    from .diagnostics import byte_range_to_lsp_range

    rng = byte_range_to_lsp_range(source, start_byte, end_byte)
    return lsp.Range(
        start=lsp.Position(line=rng.start_line, character=rng.start_char),
        end=lsp.Position(line=rng.end_line, character=rng.end_char),
    )


def _find_range_for_text(source: str, text: str) -> lsp.Range | None:
    """Locate `text` in `source` and return an LSP Range.

    Fallback path for diagnostics that don't carry byte offsets
    (pre-audit-M-27 emissions, or callers that don't supply them).
    Uses the first occurrence; if the same copy appears twice in the
    document, the first match wins. The new offset-threading path in
    `_apply_suggestion` should be preferred whenever offsets are
    available.
    """
    idx = source.find(text)
    if idx == -1:
        return None
    end_idx = idx + len(text)
    # `str.find` returns character offset, but our helper wants byte
    # offsets. Convert via utf-8 encoding length up to the index.
    start_byte = len(source[:idx].encode("utf-8"))
    end_byte = len(source[:end_idx].encode("utf-8"))
    return _byte_range_to_lsp_range(source, start_byte, end_byte)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    """Console script entry point — spoken via `uvx contentrx-lsp`.

    Defaults to stdio transport, which is what every editor extension
    uses to launch LSP servers.
    """
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    SERVER.start_io()


if __name__ == "__main__":
    main()
