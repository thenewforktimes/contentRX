"""Flag standards whose `rule` text is suspiciously close to a known
external style-guide snippet without attribution.

Human-eval build plan Session 35. The model leans on public sources
(per ADR 2026-05-06-source-name-anonymization, the corpus carries
functional descriptors of source category rather than brand names)
and attributes them via the `sources` field on each standard. This
tool catches the failure mode where a rule was lightly paraphrased
from an external source without being added to `sources`, or where
the paraphrase is close enough that the `influences` metadata should
explicitly call out the relationship.

Approach:

1. Load the standards library.
2. Load a corpus of external-source snippets (committed at
   `evals/external_source_snippets.json`). Each snippet carries a
   `source` and a short `text` excerpt that the ContentRX author
   transcribed from the public material.
3. For every (standard, snippet) pair, compute a SequenceMatcher
   ratio over normalised text.
4. Emit a warning for any pair whose ratio >= THRESHOLD where the
   source isn't already listed in the standard's `sources` (or the
   `influences` if present).

The tool exits 1 when warnings are found, 0 otherwise. Corpus file
is optional: if it doesn't exist, the tool prints a skip notice and
exits 0 (same discipline as the held-out gate — opt-in, never
silently bypassed).

Usage:
    python3 tools/check_close_paraphrase.py
    python3 tools/check_close_paraphrase.py --threshold 0.65 --json
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_LIBRARY = REPO_ROOT / "src" / "content_checker" / "standards" / "standards_library.json"
DEFAULT_CORPUS = REPO_ROOT / "evals" / "external_source_snippets.json"

# Threshold chosen empirically: SequenceMatcher.ratio ≥ 0.65 catches
# paraphrases that share most of the structure (reorder, synonym
# swap) while staying below the "unrelated but share a topic" floor
# at ≈ 0.4. Tune via --threshold when iterating on the corpus.
DEFAULT_THRESHOLD = 0.65


@dataclass(frozen=True)
class Snippet:
    source: str
    text: str
    url: str | None = None


@dataclass(frozen=True)
class Match:
    standard_id: str
    source: str
    ratio: float
    rule_text: str
    snippet_text: str
    snippet_url: str | None


def normalise(text: str) -> str:
    """Lowercase + collapse whitespace + strip punctuation for fuzzy
    comparison. The goal is to match phrasing patterns, not exact
    formatting.
    """
    text = text.lower()
    text = re.sub(r"[^\w\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def similarity(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, normalise(a), normalise(b)).ratio()


def load_library(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_snippets(path: Path) -> list[Snippet]:
    if not path.exists():
        return []
    raw = json.loads(path.read_text(encoding="utf-8"))
    return [
        Snippet(
            source=entry["source"],
            text=entry["text"],
            url=entry.get("url"),
        )
        for entry in raw.get("snippets", [])
    ]


def attributed_sources(std: dict) -> set[str]:
    """Sources the standard has already acknowledged. `sources` alone
    is sufficient — `influences` doesn't need to cover every source
    (per the plan's acceptance criteria, only where the relationship
    is worth naming explicitly).
    """
    return set(std.get("sources") or [])


def find_matches(
    library: dict,
    snippets: list[Snippet],
    *,
    threshold: float,
) -> list[Match]:
    matches: list[Match] = []
    for cat in library.get("categories", []):
        for std in cat.get("standards", []):
            rule = std.get("rule", "")
            if not rule:
                continue
            cited = attributed_sources(std)
            for snippet in snippets:
                if snippet.source in cited:
                    # Already attributed — no warning needed. (The
                    # close-paraphrase check is about UNDOCUMENTED
                    # proximity, not about whether the wording could
                    # be further apart.)
                    continue
                ratio = similarity(rule, snippet.text)
                if ratio >= threshold:
                    matches.append(
                        Match(
                            standard_id=std["id"],
                            source=snippet.source,
                            ratio=round(ratio, 3),
                            rule_text=rule,
                            snippet_text=snippet.text,
                            snippet_url=snippet.url,
                        )
                    )
    matches.sort(key=lambda m: (-m.ratio, m.standard_id, m.source))
    return matches


def format_matches(matches: list[Match]) -> str:
    if not matches:
        return "No close-paraphrase warnings.\n"
    lines = [
        f"{len(matches)} standard(s) close to an external source without attribution:",
        "",
    ]
    for m in matches:
        lines.append(f"  {m.standard_id} — ratio {m.ratio:.3f} against {m.source!r}")
        lines.append(f"    rule: {m.rule_text[:120]}{'…' if len(m.rule_text) > 120 else ''}")
        lines.append(f"    src:  {m.snippet_text[:120]}{'…' if len(m.snippet_text) > 120 else ''}")
        if m.snippet_url:
            lines.append(f"    url:  {m.snippet_url}")
        lines.append("")
    lines.extend([
        "Fix by either:",
        "  - adding the source to `sources` (and an `influences` entry",
        "    naming the relationship) on the affected standard, OR",
        "  - rewording the rule so its phrasing is genuinely independent.",
        "",
        "See docs-site/app/model/standards/[id]/page.tsx for how the",
        "`influences` field renders on the public /model page.",
    ])
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--library",
        type=Path,
        default=DEFAULT_LIBRARY,
        help="Path to standards_library.json.",
    )
    parser.add_argument(
        "--corpus",
        type=Path,
        default=DEFAULT_CORPUS,
        help="Path to the external-source snippet corpus JSON.",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=DEFAULT_THRESHOLD,
        help=f"Similarity ratio at or above which to warn. Default {DEFAULT_THRESHOLD}.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit JSON matches (for machine consumption); default is text.",
    )
    args = parser.parse_args()

    snippets = load_snippets(args.corpus)
    if not snippets:
        print(
            f"External-source corpus not found at {args.corpus} — "
            "check skipped. Populate the corpus to enable the gate.",
            file=sys.stderr,
        )
        return 0

    library = load_library(args.library)
    matches = find_matches(library, snippets, threshold=args.threshold)

    if args.json:
        print(json.dumps(
            {
                "threshold": args.threshold,
                "match_count": len(matches),
                "matches": [
                    {
                        "standard_id": m.standard_id,
                        "source": m.source,
                        "ratio": m.ratio,
                        "rule_text": m.rule_text,
                        "snippet_text": m.snippet_text,
                        "snippet_url": m.snippet_url,
                    }
                    for m in matches
                ],
            },
            indent=2,
        ))
    else:
        print(format_matches(matches))

    return 1 if matches else 0


if __name__ == "__main__":
    sys.exit(main())


__all__ = [
    "DEFAULT_THRESHOLD",
    "Match",
    "Snippet",
    "attributed_sources",
    "find_matches",
    "format_matches",
    "load_library",
    "load_snippets",
    "normalise",
    "similarity",
]
