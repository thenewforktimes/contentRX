"""Tests for the auth + base-URL resolution helpers."""

from __future__ import annotations

import pytest

from contentrx_mcp.auth import (
    AuthError,
    get_api_base_url,
    get_api_key,
)


class TestGetApiKey:
    def test_missing_key_raises(self, monkeypatch):
        monkeypatch.delenv("CONTENTRX_API_KEY", raising=False)
        with pytest.raises(AuthError, match="not set"):
            get_api_key()

    def test_blank_key_raises(self, monkeypatch):
        monkeypatch.setenv("CONTENTRX_API_KEY", "   ")
        with pytest.raises(AuthError, match="not set"):
            get_api_key()

    def test_malformed_no_prefix(self, monkeypatch):
        monkeypatch.setenv("CONTENTRX_API_KEY", "wrong_prefix_12345678")
        with pytest.raises(AuthError, match="does not look like"):
            get_api_key()

    def test_too_short(self, monkeypatch):
        monkeypatch.setenv("CONTENTRX_API_KEY", "cx_short")
        with pytest.raises(AuthError, match="does not look like"):
            get_api_key()

    def test_valid_key_returned(self, monkeypatch):
        monkeypatch.setenv(
            "CONTENTRX_API_KEY", "cx_abcdefghijklmnopqrstuvwxyz",
        )
        assert get_api_key() == "cx_abcdefghijklmnopqrstuvwxyz"

    def test_whitespace_stripped(self, monkeypatch):
        monkeypatch.setenv(
            "CONTENTRX_API_KEY", "  cx_abcdefghijklmnopqrstuvwxyz  ",
        )
        assert get_api_key() == "cx_abcdefghijklmnopqrstuvwxyz"


class TestGetApiBaseUrl:
    def test_default_is_https_prod(self, monkeypatch):
        monkeypatch.delenv("CONTENTRX_API_URL", raising=False)
        monkeypatch.delenv("CONTENTRX_INSECURE_HTTP", raising=False)
        assert get_api_base_url() == "https://content-rx.vercel.app"

    def test_custom_https_url(self, monkeypatch):
        monkeypatch.setenv("CONTENTRX_API_URL", "https://staging.contentrx.app/")
        assert get_api_base_url() == "https://staging.contentrx.app"

    def test_http_rejected_by_default(self, monkeypatch):
        monkeypatch.setenv("CONTENTRX_API_URL", "http://localhost:3000")
        monkeypatch.delenv("CONTENTRX_INSECURE_HTTP", raising=False)
        with pytest.raises(AuthError, match="must use https"):
            get_api_base_url()

    def test_http_allowed_with_insecure_escape(self, monkeypatch):
        monkeypatch.setenv("CONTENTRX_API_URL", "http://localhost:3000")
        monkeypatch.setenv("CONTENTRX_INSECURE_HTTP", "1")
        assert get_api_base_url() == "http://localhost:3000"

    def test_trailing_slash_stripped(self, monkeypatch):
        monkeypatch.setenv("CONTENTRX_API_URL", "https://x.example/")
        assert get_api_base_url() == "https://x.example"
