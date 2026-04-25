"""Engine-side feature flags.

Currently exposes one flag — ``PUBLIC_TAXONOMY`` — which controls
whether ``standard_id`` and ``rule_version`` populate on user-facing
surfaces. See ``decisions/2026-04-25-private-taxonomy-pivot.md`` for
the policy and the alternatives considered.

Default is ``false`` everywhere. The flag is the single configurable
boundary between the (default) private-taxonomy world and the
(preserved-but-off) public-taxonomy world. Code paths gated by it stay
in the codebase even when off — they are reversibility insurance, not
dead code.

Reads happen via ``is_public_taxonomy_enabled()`` rather than a
module-level constant so tests can monkey-patch ``os.environ`` and see
the change without re-importing the module.

Truthy values (case-insensitive): ``"true"``, ``"1"``, ``"yes"``,
``"on"``. Anything else (including the empty string and unset env
vars) is falsy.
"""

from __future__ import annotations

import os

_PUBLIC_TAXONOMY_ENV_VAR = "PUBLIC_TAXONOMY"
_TRUTHY_VALUES = frozenset({"true", "1", "yes", "on"})


def is_public_taxonomy_enabled() -> bool:
    """Return True iff PUBLIC_TAXONOMY is set to a recognized truthy value."""
    raw = os.environ.get(_PUBLIC_TAXONOMY_ENV_VAR, "")
    return raw.strip().lower() in _TRUTHY_VALUES
