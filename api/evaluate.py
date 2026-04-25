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

from content_checker import check  # noqa: E402
from content_checker.api_utils import PromptInjectionError  # noqa: E402
from content_checker.classify import classify  # noqa: E402
from content_checker.moments import (  # noqa: E402
    MOMENT_TAXONOMY,
    MOMENT_WEIGHTS,
    detect_moment,
)
from content_checker.standards.loader import load_standards  # noqa: E402
from content_checker.suggest_fix import suggest_fix  # noqa: E402


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

        # Catalog mode: returns the moments taxonomy + weighted-standards
        # mapping. Used by /api/moments to back the MCP server's
        # `list_standards(moment=...)` filter and the
        # `contentrx://moments` resource. No text required — this is a
        # static-ish data query, not an evaluation.
        if mode == "catalog":
            return self._respond(
                200,
                {
                    "result": {
                        "moments": [
                            {
                                "id": mid,
                                "description": desc,
                                "weighted_standards": [
                                    {
                                        "standard_id": w.standard_id,
                                        "modifier": w.modifier,
                                        "rationale": w.rationale,
                                    }
                                    for w in MOMENT_WEIGHTS.get(mid, [])
                                ],
                            }
                            for mid, desc in MOMENT_TAXONOMY.items()
                        ],
                    },
                    "latency_ms": 0,
                    "tokens": {"input": 0, "output": 0},
                },
            )

        text = body.get("text")
        if not isinstance(text, str) or not text:
            return self._respond(400, {"error": "text is required"})

        # Suggest-fix mode: rewrite a flagged string to clear a specific
        # standard. BUILD_PLAN_v2 Session 17 — consumed by the LSP's
        # code-action provider and (eventually) the web dashboard's
        # rewrite-in-place action.
        if mode == "suggest_fix":
            standard_id = body.get("standard_id")
            if not isinstance(standard_id, str) or not standard_id:
                return self._respond(
                    400, {"error": "standard_id is required for mode=suggest_fix"}
                )
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

        # Classify-only mode: cheap (~1 LLM call) helper used by the MCP
        # server's classify_moment tool. Skips the full check pipeline
        # so MCP clients can plan content without burning a quota slot
        # on every classification probe.
        if mode == "classify":
            try:
                content_types = load_standards().get("content_types", [])
                content_type, classify_latency_s, classify_tokens = classify(
                    text=text, content_types=content_types,
                )
                moment = detect_moment(text=text, content_type=content_type)
            except PromptInjectionError as exc:
                return self._respond(400, {"error": str(exc)})
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
                    },
                },
            )

        try:
            result, latency_s, tokens = check(
                text=text,
                content_type=body.get("content_type"),
                audience=body.get("audience", "product_ui"),
                moment=body.get("moment"),
            )
        except PromptInjectionError as exc:
            # Caller-side error: input contained our sentinel. Return 400
            # with the message so the caller can show it to the user
            # ("modify the input and retry"). Doesn't burn a quota slot.
            return self._respond(400, {"error": str(exc)})
        except Exception:  # noqa: BLE001
            # Keep the full traceback in stderr (Vercel captures it,
            # Sentry ingests from there) but return a generic message
            # to the caller. The exception string can include file
            # paths, model names, Anthropic error bodies, or truncated
            # LLM output — none of which the TS caller should surface.
            # (ENG-H-01 from 2026-04-22 audit.)
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
                },
            },
        )

    # Silence default stderr logging from BaseHTTPRequestHandler —
    # Vercel captures our explicit logs; the default format is noisy.
    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        return

    def _respond(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
