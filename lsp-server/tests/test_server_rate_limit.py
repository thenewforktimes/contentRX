"""Tests for the per-document token-bucket rate limiter on the server.

Exercises `DocumentState.try_take` without spinning up a full LSP
server. Deterministic: no real sleeps — we drive time forward via
explicit `now` values.
"""

from __future__ import annotations

from contentrx_lsp.server import DocumentState, RATE_LIMIT_PER_SECOND


def test_initial_bucket_allows_RATE_LIMIT_PER_SECOND_checks_immediately():
    state = DocumentState()
    now = 1000.0
    taken = 0
    while state.try_take(now):
        taken += 1
        if taken > 10:
            break
    # Starting pool is RATE_LIMIT_PER_SECOND tokens (currently 2).
    assert taken == RATE_LIMIT_PER_SECOND


def test_bucket_refills_over_time():
    state = DocumentState()
    now = 1000.0
    # Drain.
    while state.try_take(now):
        pass
    # One full second later → should have RATE_LIMIT_PER_SECOND tokens back.
    taken = 0
    after = now + 1.0
    while state.try_take(after):
        taken += 1
        if taken > 10:
            break
    assert taken == RATE_LIMIT_PER_SECOND


def test_bucket_fractional_refill():
    state = DocumentState()
    now = 1000.0
    while state.try_take(now):
        pass
    # Half a second later — we should have ~1 token.
    later = now + 0.5
    assert state.try_take(later) is True
    # But not two.
    assert state.try_take(later) is False


def test_bucket_caps_at_ceiling():
    state = DocumentState()
    state.last_refill_ts = 1000.0
    # Idle for 10 seconds; tokens should cap at RATE_LIMIT_PER_SECOND,
    # not accumulate to 20.
    much_later = 1010.0
    state.refill(much_later)
    assert state.tokens == float(RATE_LIMIT_PER_SECOND)
