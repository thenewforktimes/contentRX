"""Tests for tools/refinement_candidate_detector.py.

Human-eval build plan Session 34. The detector turns aggregated
signals into refinement-log candidates; these tests pin the
threshold behavior at the pure-logic layer so regressions don't
surface as mysterious log noise.
"""

from __future__ import annotations

import pytest

from tools.refinement_candidate_detector import (
    AUTO_REF_PREFIX,
    AUTO_SECTION_HEADER,
    Candidate,
    ConflictCluster,
    OODCluster,
    OverrideCluster,
    SignalDump,
    StandardSignal,
    existing_auto_id_by_title,
    next_available_auto_index,
    propose_candidates,
    reconcile_ref_ids,
    render_markdown,
    splice_auto_section,
)


TODAY = "2026-04-24"


def _dump(**overrides) -> SignalDump:
    defaults = dict(
        generated_at="2026-04-24T06:00:00Z",
        standards=[],
        override_clusters=[],
        ood_clusters=[],
        conflict_clusters=[],
        standard_first_seen={},
    )
    defaults.update(overrides)
    return SignalDump(**defaults)


# ---------------------------------------------------------------------------
# Retirement — rare fires
# ---------------------------------------------------------------------------


def test_retirement_rare_fires_triggers_at_half_percent():
    """0.5% exact — plan-spec threshold."""
    dump = _dump(standards=[
        StandardSignal(
            standard_id="PRF-22",
            fires_90d=5,
            total_evaluations_90d=1000,  # 0.5% exactly → trigger
            fires_30d=2,
            overrides_30d=0,
            co_firing_standards_30d={},
            unique_fires_30d=2,
        ),
    ])
    candidates = propose_candidates(dump, today=TODAY)
    assert len(candidates) == 1
    assert candidates[0].kind == "retirement"
    assert "PRF-22" in candidates[0].title
    assert "0.50%" in candidates[0].proposed_change


def test_retirement_does_not_fire_above_threshold():
    dump = _dump(standards=[
        StandardSignal(
            standard_id="CLR-01",
            fires_90d=100,
            total_evaluations_90d=1000,  # 10%
            fires_30d=30,
            overrides_30d=0,
            co_firing_standards_30d={},
            unique_fires_30d=30,
        ),
    ])
    assert propose_candidates(dump, today=TODAY) == []


# ---------------------------------------------------------------------------
# Retirement — high override rate
# ---------------------------------------------------------------------------


def test_retirement_override_rate_triggers_above_thirty_percent():
    dump = _dump(standards=[
        StandardSignal(
            standard_id="GRM-06",
            fires_90d=500,  # plenty — rare-fires doesn't fire
            total_evaluations_90d=1000,
            fires_30d=100,
            overrides_30d=35,  # 35%
            co_firing_standards_30d={},
            unique_fires_30d=100,
        ),
    ])
    candidates = propose_candidates(dump, today=TODAY)
    assert len(candidates) == 1
    assert "override-rate" in candidates[0].title
    assert "35.0%" in candidates[0].proposed_change


def test_retirement_override_rate_respects_minimum_fires_floor():
    """Rare standards with a high override ratio but only a few fires
    don't trigger — the 10-fire floor filters noise.
    """
    dump = _dump(standards=[
        StandardSignal(
            standard_id="PRF-22",
            fires_90d=50,
            total_evaluations_90d=1000,  # 5% → rare-fire threshold NOT tripped
            fires_30d=5,  # under the 10-fire floor
            overrides_30d=3,  # 60% but below floor
            co_firing_standards_30d={},
            unique_fires_30d=5,
        ),
    ])
    assert propose_candidates(dump, today=TODAY) == []


# ---------------------------------------------------------------------------
# Retirement — subsumption
# ---------------------------------------------------------------------------


def test_retirement_subsumption_requires_newer_co_firer():
    dump = _dump(
        standards=[
            StandardSignal(
                standard_id="CLR-04",
                fires_90d=200,
                total_evaluations_90d=1000,  # 20%
                fires_30d=60,
                overrides_30d=5,
                co_firing_standards_30d={"CLR-09": 55, "VT-01": 2},
                unique_fires_30d=0,  # fully covered by a co-firer
            ),
        ],
        standard_first_seen={
            "CLR-04": "2025-11-01",
            "CLR-09": "2026-02-15",  # newer than CLR-04
            "VT-01": "2025-09-01",
        },
    )
    candidates = propose_candidates(dump, today=TODAY)
    kinds = [c.kind for c in candidates]
    assert "retirement" in kinds
    subsumption = next(c for c in candidates if "subsumed" in c.title)
    assert "CLR-09" in subsumption.title
    assert "CLR-09×55" in subsumption.triggering_cases


def test_retirement_subsumption_skips_when_co_firer_is_older():
    dump = _dump(
        standards=[
            StandardSignal(
                standard_id="CLR-04",
                fires_90d=200,
                total_evaluations_90d=1000,
                fires_30d=60,
                overrides_30d=5,
                co_firing_standards_30d={"CLR-02": 55},
                unique_fires_30d=0,
            ),
        ],
        standard_first_seen={
            "CLR-04": "2026-02-01",
            "CLR-02": "2025-09-01",  # OLDER — not a subsumption candidate
        },
    )
    # Neither rare-fire nor override-rate triggers; subsumption
    # requires the co-firer to be newer.
    candidates = propose_candidates(dump, today=TODAY)
    assert not any("subsumed" in c.title for c in candidates)


# ---------------------------------------------------------------------------
# Refinement — override clusters
# ---------------------------------------------------------------------------


def test_refinement_override_cluster_requires_three_distinct_actors():
    dump = _dump(
        override_clusters=[
            OverrideCluster(
                standard_id="PRF-11",
                reason_code="not_applicable_here",
                count_30d=20,
                distinct_actors=2,  # below the minimum
            ),
            OverrideCluster(
                standard_id="PRF-12",
                reason_code="not_applicable_here",
                count_30d=20,
                distinct_actors=3,  # at the minimum — triggers
            ),
        ]
    )
    candidates = propose_candidates(dump, today=TODAY)
    titles = [c.title for c in candidates]
    assert any("PRF-12" in t for t in titles)
    assert not any("PRF-11" in t for t in titles)


def test_refinement_override_cluster_suggests_moment_relax_for_strict_reason():
    """Architectural-consequence text steers to a useful next action
    depending on the reason_code."""
    dump = _dump(
        override_clusters=[
            OverrideCluster(
                standard_id="VT-05",
                reason_code="standard_too_strict",
                count_30d=15,
                distinct_actors=5,
            ),
        ]
    )
    [cand] = propose_candidates(dump, today=TODAY)
    assert "moment-specific relax" in cand.architectural_consequence.lower()


# ---------------------------------------------------------------------------
# Refinement — standards_conflict clusters
# ---------------------------------------------------------------------------


def test_refinement_conflict_cluster_requires_two_sources():
    dump = _dump(
        conflict_clusters=[
            ConflictCluster(
                standard_ids=("CLR-01", "CLR-04"),
                count_30d=6,
                distinct_sources=1,  # below the minimum
            ),
            ConflictCluster(
                standard_ids=("VT-01", "VT-05"),
                count_30d=6,
                distinct_sources=2,
            ),
        ]
    )
    candidates = propose_candidates(dump, today=TODAY)
    assert len(candidates) == 1
    assert "VT-01 + VT-05" in candidates[0].title
    assert candidates[0].kind == "refinement"


# ---------------------------------------------------------------------------
# Moment / content-type — out_of_distribution clusters
# ---------------------------------------------------------------------------


def test_ood_cluster_requires_five_cases_and_two_sources():
    dump = _dump(
        ood_clusters=[
            # Too few cases.
            OODCluster(
                moment="wayfinding",
                content_type="ui_label",
                case_count_60d=4,
                distinct_sources=3,
            ),
            # Only one source.
            OODCluster(
                moment="destructive_action",
                content_type="button_cta",
                case_count_60d=10,
                distinct_sources=1,
            ),
            # Passes both thresholds.
            OODCluster(
                moment="wayfinding",
                content_type="data_viz_label",
                case_count_60d=7,
                distinct_sources=2,
                sample_text_hashes=("abc123def4567890", "fff0000111222333"),
                representative_note="Chart axis label uppercased by convention",
            ),
        ]
    )
    candidates = propose_candidates(dump, today=TODAY)
    assert len(candidates) == 1
    cand = candidates[0]
    assert cand.kind == "moment_content_type"
    assert "wayfinding × data_viz_label" in cand.title
    # Sample hashes appear truncated in the triggering-cases block.
    assert "abc123def4" in cand.triggering_cases
    assert "Representative note:" in cand.triggering_cases


def test_ood_cluster_handles_missing_moment_or_content_type():
    dump = _dump(
        ood_clusters=[
            OODCluster(
                moment=None,
                content_type="heading",
                case_count_60d=6,
                distinct_sources=2,
            ),
        ]
    )
    [cand] = propose_candidates(dump, today=TODAY)
    assert cand.current_category == "heading"
    assert cand.title.startswith("heading — out_of_distribution")


# ---------------------------------------------------------------------------
# Ref-ID assignment
# ---------------------------------------------------------------------------


def test_ref_ids_are_zero_padded_and_sequential():
    dump = _dump(
        standards=[
            StandardSignal(
                standard_id=f"PRF-{i:02d}",
                fires_90d=1,
                total_evaluations_90d=1000,
                fires_30d=0,
                overrides_30d=0,
                co_firing_standards_30d={},
                unique_fires_30d=0,
            )
            for i in range(20, 23)
        ]
    )
    candidates = propose_candidates(dump, starting_index=7, today=TODAY)
    assert [c.ref_id for c in candidates] == [
        f"{AUTO_REF_PREFIX}007",
        f"{AUTO_REF_PREFIX}008",
        f"{AUTO_REF_PREFIX}009",
    ]


# ---------------------------------------------------------------------------
# Markdown rendering + splice
# ---------------------------------------------------------------------------


def test_render_markdown_empty_returns_placeholder():
    md = render_markdown([])
    assert AUTO_SECTION_HEADER in md
    assert "No auto-detected candidates" in md


def test_render_markdown_has_every_spec_field_per_entry():
    cand = Candidate(
        ref_id="REF-A001",
        kind="retirement",
        title="PRF-22 — rare-fire retirement candidate",
        current_category="PRF-22",
        proposed_change="Retire PRF-22.",
        triggering_cases="Auto-detected.",
        architectural_consequence="Savings in tokens per scan.",
        date_logged=TODAY,
    )
    md = render_markdown([cand])
    for marker in [
        "### REF-A001:",
        "**Current category:** `PRF-22`",
        "**Proposed change:**",
        "**Triggering cases:**",
        "**Architectural consequence:**",
        f"**Date logged:** {TODAY}",
        "**Verdict:** Pending",
    ]:
        assert marker in md, f"missing {marker!r}"


def test_splice_auto_section_replaces_existing_block():
    original = (
        "# Taxonomy refinement log\n\n"
        "## Open refinements\n\n(old open)\n\n"
        f"{AUTO_SECTION_HEADER}\n\n"
        "### REF-A001: stale entry\n\n"
        "some body\n\n"
        "## Approved refinements\n\n(none)\n"
    )
    new_block = f"{AUTO_SECTION_HEADER}\n\nfresh body\n"
    out = splice_auto_section(original, new_block)
    assert "fresh body" in out
    assert "stale entry" not in out
    assert out.count(AUTO_SECTION_HEADER) == 1


def test_splice_auto_section_inserts_before_approved_on_first_run():
    original = (
        "# Taxonomy refinement log\n\n"
        "## Open refinements\n\n(none)\n\n"
        "## Approved refinements\n\n(none)\n"
    )
    new_block = f"{AUTO_SECTION_HEADER}\n\nfirst body\n"
    out = splice_auto_section(original, new_block)
    assert out.index("first body") < out.index("## Approved refinements")


def test_next_available_auto_index_reads_max_plus_one():
    text = (
        f"{AUTO_SECTION_HEADER}\n\n"
        f"### REF-A001: thing\n\n"
        f"### REF-A007: other thing\n\n"
        "### REF-002: not auto\n"
    )
    assert next_available_auto_index(text) == 8


def test_next_available_auto_index_starts_at_one_when_empty():
    assert next_available_auto_index("no auto entries here") == 1


# ---------------------------------------------------------------------------
# Idempotency — reconcile_ref_ids preserves prior-run ids
# ---------------------------------------------------------------------------


def _retirement_candidate(standard_id: str) -> Candidate:
    return Candidate(
        ref_id="UNASSIGNED",
        kind="retirement",
        title=f"{standard_id} — rare-fire retirement candidate",
        current_category=standard_id,
        proposed_change="Retire.",
        triggering_cases="Sampled.",
        architectural_consequence="Savings.",
        date_logged=TODAY,
    )


def test_reconcile_reuses_prior_run_id_when_title_matches():
    log = (
        f"{AUTO_SECTION_HEADER}\n\n"
        "### REF-A003: PRF-22 — rare-fire retirement candidate\n\n"
        "**Current category:** `PRF-22`\n\n"
        "body...\n"
    )
    cand = _retirement_candidate("PRF-22")
    [out] = reconcile_ref_ids([cand], log)
    assert out.ref_id == "REF-A003"


def test_reconcile_assigns_fresh_ids_to_new_candidates():
    log = (
        f"{AUTO_SECTION_HEADER}\n\n"
        "### REF-A001: PRF-22 — rare-fire retirement candidate\n\n"
    )
    prior = _retirement_candidate("PRF-22")
    novel = _retirement_candidate("CLR-99")
    out = reconcile_ref_ids([prior, novel], log)
    ids = {c.title: c.ref_id for c in out}
    assert ids["PRF-22 — rare-fire retirement candidate"] == "REF-A001"
    assert ids["CLR-99 — rare-fire retirement candidate"] == "REF-A002"


def test_reconcile_sorts_output_by_ref_id():
    log = (
        f"{AUTO_SECTION_HEADER}\n\n"
        "### REF-A005: PRF-22 — rare-fire retirement candidate\n\n"
    )
    out = reconcile_ref_ids(
        [
            _retirement_candidate("CLR-99"),  # will get A006
            _retirement_candidate("PRF-22"),  # keeps A005
        ],
        log,
    )
    assert [c.ref_id for c in out] == ["REF-A005", "REF-A006"]


def test_existing_auto_id_by_title_parses_header_lines():
    log = (
        f"{AUTO_SECTION_HEADER}\n\n"
        "### REF-A001: title one\n\n"
        "body\n\n"
        "### REF-A002: title two\n\n"
        "body\n"
    )
    assert existing_auto_id_by_title(log) == {
        "title one": "REF-A001",
        "title two": "REF-A002",
    }


def test_end_to_end_idempotent_when_signals_unchanged(tmp_path):
    """Full round-trip: render → splice → re-run with same signals
    produces byte-identical output. This is the property the nightly
    workflow depends on to no-op when the override stream is quiet.
    """
    log = tmp_path / "log.md"
    log.write_text(
        "# Taxonomy refinement log\n\n"
        "## Open refinements\n\n(none)\n\n"
        "## Approved refinements\n\n(none)\n",
        encoding="utf-8",
    )
    dump = _dump(standards=[
        StandardSignal(
            standard_id="PRF-22",
            fires_90d=4,
            total_evaluations_90d=1000,
            fires_30d=1,
            overrides_30d=0,
            co_firing_standards_30d={},
            unique_fires_30d=1,
        ),
    ])

    # First run.
    cands1 = reconcile_ref_ids(propose_candidates(dump, today=TODAY), log.read_text())
    log.write_text(splice_auto_section(log.read_text(), render_markdown(cands1)))
    pass_one = log.read_text()

    # Second run against the updated log — must match byte-for-byte.
    cands2 = reconcile_ref_ids(propose_candidates(dump, today=TODAY), log.read_text())
    log.write_text(splice_auto_section(log.read_text(), render_markdown(cands2)))
    pass_two = log.read_text()

    assert pass_one == pass_two
    # And exactly one auto section header.
    assert pass_two.count(AUTO_SECTION_HEADER) == 1
