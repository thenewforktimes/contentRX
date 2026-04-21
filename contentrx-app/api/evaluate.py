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

# The content_checker package is vendored at ./python/ in this repo.
# Vercel sets the project root as cwd (/var/task); __file__ lives at
# /var/task/api/evaluate.py, so python/ is one directory up.
_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(_ROOT, "python"))

from content_checker import check  # noqa: E402


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

        text = body.get("text")
        if not isinstance(text, str) or not text:
            return self._respond(400, {"error": "text is required"})

        try:
            result, latency_s, tokens = check(
                text=text,
                content_type=body.get("content_type"),
                audience=body.get("audience", "product_ui"),
                moment=body.get("moment"),
            )
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            return self._respond(500, {"error": f"Evaluation failed: {exc}"})

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
