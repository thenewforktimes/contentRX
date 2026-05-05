"""Vercel Python function — runs the content_checker pipeline.

Internal endpoint. Only callable with x-internal-secret header matching
INTERNAL_EVAL_SECRET. The TS /api/check route is the public hot path and
is responsible for auth, quota, rate limiting, and violation logging.
This function just evaluates.

POST /api/evaluate
Request:
  {
    "text": "Click here",
    "content_type": "button_cta"       # optional
    "audience": "product_ui"            # optional, default product_ui
    "moment": "decision_point"          # optional, auto-detected if omitted
  }

Response:
  {
    "result": { ...CheckResult.to_dict() },
    "latency_ms": 1234,
    "tokens": { "input": 500, "output": 200 }
  }
"""

from __future__ import annotations

import hmac
import json
import os
import sys
import traceback
from http.server import BaseHTTPRequestHandler

# content_checker is the Python engine package at the monorepo root
# (src/content_checker/). Vercel's project root is cwd (/var/task/) and
# __file__ is at /var/task/api/evaluate.py, so src/ is one directory up.
# `vercel.json` → functions.includeFiles bundles src/content_checker/**
# with this function so the import resolves at runtime.
_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(_ROOT, "src"))

# Module-level imports kept to the cheap path. Heavy imports (check,
# classify, load_standards, suggest_fix) move inside their handler
# branches so cold starts that only handle classify or suggest_fix
# don't pay for the LLM stack. Python's module cache avoids re-paying
# on warm instances.
from content_checker.api_utils import (  # noqa: E402
    PromptInjectionError,
    RateLimitedError,
    RequestTimeoutError,
)
from content_checker.moments import detect_moment  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        expected = os.environ.get("INTERNAL_EVAL_SECRET", "")
        if not expected:
            # Fail closed: without a shared secret this endpoint is a billing
            # DoS vector and a plaintext-leaking proxy. We log to stderr but
            # return a generic error to callers.
            print("INTERNAL_EVAL_SECRET is not set; refusing all requests", file=sys.stderr)
            return self._respond(500, {"error": "Server not configured"})

        provided = self.headers.get("x-internal-secret", "")
        # hmac.compare_digest is constant-time; provided != expected
        # short-circuits at the first mismatching byte and leaks length
        # and prefix information under repeated requests.
        if not hmac.compare_digest(provided.encode("utf-8"), expected.encode("utf-8")):
            return self._respond(401, {"error": "Unauthorized"})

        try:
            length = int(self.headers.get("content-length", "0"))
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else ""
            body = json.loads(raw) if raw else {}
        except (ValueError, json.JSONDecodeError) as exc:
            return self._respond(400, {"error": f"Invalid JSON: {exc}"})

        mode = body.get("mode", "check")

        text = body.get("text")
        if not isinstance(text, str) or not text:
            return self._respond(400, {"error": "text is required"})

        # Suggest-fix mode: rewrite a flagged string to clear a specific
        # standard. BUILD_PLAN_v2 Session 17 — consumed by the LSP's
        # code-action provider and (eventually) the web dashboard's
        # rewrite-in-place action.
        if mode == "suggest_fix":
            # ADR 2026-04-25 — standard_id is now optional. Schema-2.0.0
            # client surfaces (LSP, plugin, action, MCP) strip substrate
            # and never carry it; the rewriter falls back to issue +
            # current_suggestion. The rewriter still needs SOMETHING to
            # anchor on, so refuse a request that supplies none of
            # (standard_id, issue, current_suggestion).
            standard_id_raw = body.get("standard_id")
            standard_id: str | None = (
                standard_id_raw
                if isinstance(standard_id_raw, str) and standard_id_raw
                else None
            )
            issue_raw = body.get("issue")
            current_suggestion_raw = body.get("current_suggestion")
            if not (
                standard_id
                or (isinstance(issue_raw, str) and issue_raw)
                or (
                    isinstance(current_suggestion_raw, str)
                    and current_suggestion_raw
                )
            ):
                return self._respond(
                    400,
                    {
                        "error": (
                            "At least one of standard_id, issue, or "
                            "current_suggestion is required for mode=suggest_fix"
                        )
                    },
                )
            # Lazy import — keeps catalog/classify cold starts fast.
            from content_checker.suggest_fix import suggest_fix  # noqa: PLC0415
            try:
                result = suggest_fix(
                    text=text,
                    standard_id=standard_id,
                    rule=body.get("rule"),
                    issue=body.get("issue"),
                    current_suggestion=body.get("current_suggestion"),
                )
            except PromptInjectionError as exc:
                return self._respond(400, {"error": str(exc)})
            except RateLimitedError as exc:
                return self._respond(503, {"error": str(exc)}, retry_after=30)
            except RequestTimeoutError as exc:
                return self._respond(504, {"error": str(exc)})
            except Exception:  # noqa: BLE001
                traceback.print_exc()
                return self._respond(500, {"error": "Suggestion failed"})

            return self._respond(
                200,
                {
                    "result": {
                        "rewritten": result.rewritten,
                        "standard_id": standard_id,
                    },
                    "latency_ms": result.latency_ms,
                    "tokens": {
                        "input": result.input_tokens,
                        "output": result.output_tokens,
                    },
                },
            )

        # Document rewrite mode: produces a holistic clean version of
        # the input in the ContentRX house voice. The dashboard's
        # Document tier calls this in parallel with the regular check
        # so the customer sees both findings AND a suggested rewrite.
        # See rewrite_document.py for the prompt + output contract.
        if mode == "rewrite_document":
            from content_checker.rewrite_document import (  # noqa: PLC0415
                rewrite_document,
            )
            try:
                result = rewrite_document(text=text)
            except PromptInjectionError as exc:
                return self._respond(400, {"error": str(exc)})
            except RateLimitedError as exc:
                return self._respond(503, {"error": str(exc)}, retry_after=30)
            except RequestTimeoutError as exc:
                return self._respond(504, {"error": str(exc)})
            except Exception:  # noqa: BLE001
                traceback.print_exc()
                return self._respond(500, {"error": "Rewrite failed"})

            return self._respond(
                200,
                {
                    "result": {
                        "rewritten": result.rewritten,
                        # Schema 2.4.0 — one-sentence diagnostic for the
                        # Document-tier verdict header. Empty string when
                        # the LLM's JSON output couldn't be parsed; the
                        # rewrite still ships in that case.
                        "diagnostic": result.diagnostic,
                    },
                    "latency_ms": result.latency_ms,
                    "tokens": {
                        "input": result.input_tokens,
                        "output": result.output_tokens,
                        "cache_creation_input": result.cache_creation_input_tokens,
                        "cache_read_input": result.cache_read_input_tokens,
                    },
                },
            )

        # Classify-only mode: cheap (~1 LLM call) helper used by the MCP
        # server's classify_moment tool. Skips the full check pipeline
        # so MCP clients can plan content without burning a quota slot
        # on every classification probe.
        if mode == "classify":
            # Lazy imports — catalog mode never pays for these.
            from content_checker.classify import classify  # noqa: PLC0415
            from content_checker.standards.loader import load_standards  # noqa: PLC0415
            try:
                content_types = load_standards().get("content_types", [])
                content_type, classify_latency_s, classify_tokens = classify(
                    text=text, content_types=content_types,
                )
                moment = detect_moment(text=text, content_type=content_type)
            except PromptInjectionError as exc:
                return self._respond(400, {"error": str(exc)})
            except RateLimitedError as exc:
                return self._respond(503, {"error": str(exc)}, retry_after=30)
            except RequestTimeoutError as exc:
                return self._respond(504, {"error": str(exc)})
            except Exception:  # noqa: BLE001
                traceback.print_exc()
                return self._respond(500, {"error": "Classification failed"})

            return self._respond(
                200,
                {
                    "result": {
                        "content_type": content_type,
                        "moment": moment,
                    },
                    "latency_ms": int(classify_latency_s * 1000),
                    "tokens": {
                        "input": int(getattr(classify_tokens, "input", 0)),
                        "output": int(getattr(classify_tokens, "output", 0)),
                        "cache_creation_input": int(getattr(classify_tokens, "cache_creation_input", 0)),
                        "cache_read_input": int(getattr(classify_tokens, "cache_read_input", 0)),
                    },
                },
            )

        # Lazy import — only check mode pays. Catalog/classify don't.
        from content_checker import check  # noqa: PLC0415
        # Block 2c (calibration plan): /api/check pre-fetches matching
        # precedents from suggestion_precedents and forwards them so
        # the engine can inject voice guidance into the LLM scan
        # prompt. Empty list (or omitted) → engine falls back to the
        # universal voice rules from PR #252. Schema:
        #   precedents: [{"approved_text": str, "sample_size": int}, ...]
        precedents = body.get("precedents") or []
        try:
            result, latency_s, tokens = check(
                text=text,
                content_type=body.get("content_type"),
                audience=body.get("audience", "product_ui"),
                moment=body.get("moment"),
                precedents=precedents,
            )
        except PromptInjectionError as exc:
            # Caller-side error: input contained our sentinel. Return 400
            # with the message so the caller can show it to the user
            # ("modify the input and retry"). Doesn't burn a quota slot.
            return self._respond(400, {"error": str(exc)})
        except RateLimitedError as exc:
            # Anthropic 429 after retries. /api/check should backoff,
            # not treat as a generic 500. Retry-After: 30s is a
            # reasonable starting point — Anthropic's headers carry the
            # real value but we don't surface them through the SDK.
            return self._respond(503, {"error": str(exc)}, retry_after=30)
        except RequestTimeoutError as exc:
            # Per-stage timeout exhausted. Lets /api/check distinguish
            # "engine slow" from "engine broken."
            return self._respond(504, {"error": str(exc)})
        except Exception:  # noqa: BLE001
            # Keep the full traceback in stderr (Vercel captures it,
            # Sentry ingests from there) but return a generic message
            # to the caller. The exception string can include file
            # paths, model names, Anthropic error bodies, or truncated
            # LLM output — none of which the TS caller should surface.
            # (ENG-H-01 from 2026-04-22 audit.)
            #
            # PR-193/PR-194 added internal-only `detail` + `traceback`
            # fields here as diagnostic aids during the prod 502
            # incident. Removed (audit P2): they're dead instrumentation
            # now that the engine is reliable, and skipping them keeps
            # the leak surface as small as possible. If we hit an
            # opaque error class again, reintroduce them as a 1-line
            # diagnostic hotfix per the
            # `feedback_diagnostic_detail_injection` memory pattern.
            traceback.print_exc()
            return self._respond(500, {"error": "Evaluation failed"})

        return self._respond(
            200,
            {
                "result": result.to_dict(),
                "latency_ms": int(latency_s * 1000),
                "tokens": {
                    "input": int(getattr(tokens, "input", 0)),
                    "output": int(getattr(tokens, "output", 0)),
                    "cache_creation_input": int(getattr(tokens, "cache_creation_input", 0)),
                    "cache_read_input": int(getattr(tokens, "cache_read_input", 0)),
                },
            },
        )

    # Silence default stderr logging from BaseHTTPRequestHandler —
    # Vercel captures our explicit logs; the default format is noisy.
    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        return

    def _respond(self, status: int, body: dict, *, retry_after: int | None = None) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        if retry_after is not None:
            self.send_header("retry-after", str(retry_after))
        self.end_headers()
        self.wfile.write(payload)
