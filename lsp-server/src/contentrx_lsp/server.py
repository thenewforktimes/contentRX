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
)
from .diagnostics import LspDiagnostic, violations_to_diagnostics
from .parser import extract_strings


log = logging.getLogger("contentrx-lsp")


# Per-document tuning. Public constants so tests can patch them.
DEBOUNCE_SECONDS = 0.4
RATE_LIMIT_PER_SECOND = 2
MAX_STRINGS_PER_DOCUMENT = 50


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


async def _lint_document(
    server: ContentRXLanguageServer,
    uri: str,
    source: str,
    edit_ts: float,
) -> None:
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
