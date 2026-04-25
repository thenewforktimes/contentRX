"""Pipeline orchestrator for the content standards checker.

Composes the 5 stages: classify, filter, preprocess, scan, validate.
Each stage is a separate function call — no boolean flags to toggle behavior.
Use check() for the full pipeline, or call individual stages directly.

Audience-aware: the pipeline accepts an audience parameter that propagates
through filtering, preprocessing, and LLM evaluation. See audience.py for
the audience types and their effects on each stage.

Moment-aware (v4.4.0+): the pipeline detects the experiential moment after
classification and uses it to:
    - Record the moment in CheckResult for triage tracking (Phase 1)
    - Suppress violations for standards irrelevant to the moment (Phase 2)
    - Inject moment context into the LLM system prompt (Phase 3)
See moments.py for the 12 canonical moments and their standards weights.
"""

from __future__ import annotations

import time

from content_checker.api_utils import (
    create_message,
    parse_scan_response,
    wrap_user_text,
    ParseError,
    DEFAULT_MODEL,
)
from content_checker.audience import Audience, get_audience_prompt_context, is_standard_active
from content_checker.classify import classify, classify_heuristic
from content_checker.filter import filter_standards, get_content_type_descriptions
from content_checker.models import (
    AMBIGUITY_STANDARDS_CONFLICT,
    CheckResult,
    DEFAULT_CONFIDENCE_LLM,
    HOP_CLASSIFY,
    HOP_DETECT_MOMENT,
    HOP_FILTER,
    HOP_MERGE,
    HOP_PREPROCESS,
    HOP_SCAN,
    HOP_VALIDATE,
    PassedStandard,
    PipelineMeta,
    RationaleHop,
    TokenUsage,
    Violation,
    derive_verdict,
)
from content_checker.moments import (
    MOMENT_CONFIDENCE_THRESHOLD,
    build_moment_prompt_section,
    detect_moment_with_confidence,
    get_moment_weights_applied,
    is_standard_suppressed_by_moment,
)
from content_checker.preprocess import run_preprocess
from content_checker.standards.loader import load_standards
from content_checker.validate import validate_candidates

MAX_CONTENT_LENGTH = 100_000


def _validate_text_input(text: str) -> None:
    """Guard against runaway prompts and accidental upload of large files."""
    if not isinstance(text, str):
        raise TypeError(f"text must be a string, got {type(text).__name__}")
    if len(text) > MAX_CONTENT_LENGTH:
        raise ValueError(
            f"Content too long: {len(text):,} characters "
            f"(max {MAX_CONTENT_LENGTH:,})"
        )


def _build_rule_version_map(standards_data: dict) -> dict[str, str]:
    """Snapshot standard_id → version from the loaded standards library.

    Populated by the per-standard versioning patch in the library
    (human-eval build plan Session 1). Used to stamp `rule_version` on
    every emitted Violation and to populate `rule_versions` on each
    rationale-chain hop.
    """
    versions: dict[str, str] = {}
    for cat in standards_data.get("categories", []):
        for std in cat.get("standards", []):
            sid = std.get("id")
            ver = std.get("version")
            if sid and ver:
                versions[sid] = ver
    return versions


def _stamp_rule_versions(
    violations: list[Violation],
    rule_versions: dict[str, str],
) -> None:
    """Populate Violation.rule_version from the snapshot. Mutates in place."""
    for v in violations:
        if v.rule_version is None:
            v.rule_version = rule_versions.get(v.standard_id)


def build_system_prompt(
    standards_data: dict,
    content_type: str | None = None,
    audience: Audience = Audience.PRODUCT_UI,
    moment: str = "",
) -> str:
    """Build the system prompt with embedded standards.

    Accepts either the full or filtered standards library.
    Injects audience context and moment context to calibrate LLM judgment.
    """
    standards_text = ""
    for cat in standards_data["categories"]:
        standards_text += f"\n## {cat['name']}\n"
        for std in cat["standards"]:
            standards_text += f"\n### {std['id']}: {std['rule']}\n"
            standards_text += f"- Correct: {std['correct']}\n"
            standards_text += f"- Incorrect: {std['incorrect']}\n"

    content_type_line = ""
    if content_type:
        content_type_line = (
            f"\nThis content has been classified as: **{content_type}**. "
            "Evaluate it with this content type in mind.\n"
        )

    # Audience context calibrates the LLM's judgment for the content surface
    audience_line = f"\n{get_audience_prompt_context(audience)}\n"

    # Phase 3: Moment context calibrates the LLM for the experiential moment.
    # Returns empty string for the default moment (browsing_discovery)
    # so the system prompt is unchanged for the baseline case.
    moment_section = build_moment_prompt_section(moment) if moment else ""

    return (
        "You are a content standards checker for UX and UI copy. "
        "You evaluate whether a piece of copy meets established content standards.\n"
        f"{content_type_line}"
        f"{audience_line}\n"
        f"Here are the standards you check against:\n{standards_text}\n\n"
        f"{moment_section}"
        "## How to evaluate\n\n"
        "1. Check the content against the standards listed above, applying these rules:\n"
        "   - **Only flag clear, unambiguous violations.** If you are less than 90% "
        "confident something is a violation, it is not a violation. When in doubt, "
        "the content passes.\n"
        "   - **Read the literal text exactly as written.** Do not assume or hallucinate "
        "characters. If you are checking capitalization, verify each word character by "
        'character. "Account settings" has a lowercase "s" — do not flag it as title case.\n'
        "   - **Do not flag content for standards that are only marginally relevant.** "
        "A standard must clearly apply to the content type and context.\n"
        "   - **Do not flag stylistic preferences as violations.** If the content "
        "communicates clearly and follows the spirit of the standards, minor stylistic "
        "variations are acceptable.\n"
        "   - **Default verdict is pass.** Content should only fail when there are clear "
        "violations that would meaningfully hurt the user experience.\n\n"
        "2. For each genuine violation, cite the standard ID, explain what is wrong, "
        "suggest a fix, and rate your **confidence** in this finding from 0.0 to 1.0:\n"
        "   - **1.0** — unambiguous, you'd bet on it (e.g., a literal banned word match)\n"
        "   - **0.85** — pretty sure, default for clear nuanced violations\n"
        "   - **0.6** — borderline; the rule applies but reasonable people might disagree\n"
        "   - **< 0.5** — only flag if you genuinely think it warrants a second look\n"
        "   The downstream system promotes any violation with confidence < 0.7 to a "
        '"review_recommended" verdict so a human can adjudicate. Calibrate honestly — '
        "over-confident borderline calls drown the signal; under-confident easy calls "
        "make the tool feel weak.\n\n"
        "3. Give an overall pass/fail verdict. A single minor issue does not automatically "
        "mean fail — use judgment about whether the content is good enough to ship.\n\n"
        "Respond in this exact JSON format (no markdown, no backticks):\n"
        "{\n"
        f'  "content_type": "{content_type or "detected type"}",\n'
        '  "overall_verdict": "pass" or "fail",\n'
        '  "violations": [\n'
        "    {\n"
        '      "standard_id": "the standard ID",\n'
        '      "rule": "the rule text",\n'
        '      "issue": "what\'s wrong with the content",\n'
        '      "suggestion": "how to fix it",\n'
        '      "confidence": 0.85\n'
        "    }\n"
        "  ],\n"
        '  "passes": [\n'
        "    {\n"
        '      "standard_id": "the standard ID",\n'
        '      "rule": "brief rule description"\n'
        "    }\n"
        "  ],\n"
        '  "summary": "1-2 sentence plain language summary of the assessment"\n'
        "}"
    )


def _llm_scan(
    text: str,
    standards_data: dict,
    content_type: str | None,
    model: str,
    audience: Audience = Audience.PRODUCT_UI,
    moment: str = "",
) -> tuple[dict, float, TokenUsage]:
    """Run the LLM scan stage. Returns (parsed_result, latency, tokens)."""
    prompt_ct = None if content_type == "unfiltered" else content_type
    system_prompt = build_system_prompt(
        standards_data, content_type=prompt_ct, audience=audience,
        moment=moment,
    )

    # Sentinel-delimit user `text` so a prompt-injected payload can't
    # break out of the surrounding instructions. wrap_user_text raises
    # PromptInjectionError if the input contains the sentinel itself.
    wrapped = wrap_user_text(text)
    if prompt_ct:
        user_message = f"Check this {content_type} content against the standards:\n\n{wrapped}"
    else:
        user_message = f"Check this content against the standards:\n\n{wrapped}"

    start = time.time()
    llm_response = create_message(
        system=system_prompt,
        user=user_message,
        model=model,
        max_tokens=2000,
    )
    latency = time.time() - start

    tokens = TokenUsage(
        input=llm_response.input_tokens,
        output=llm_response.output_tokens,
    )

    try:
        result = parse_scan_response(llm_response.text)
    except ParseError:
        result = {
            "content_type": content_type or "unknown",
            "overall_verdict": "error",
            "violations": [],
            "passes": [],
            "summary": f"Failed to parse response: {llm_response.text[:200]}",
        }

    return result, latency, tokens


def _parse_llm_violations(raw_violations: list[dict]) -> list[Violation]:
    """Convert raw LLM violation dicts to Violation objects.

    Optional `confidence` from the LLM response (added in v1.1.0; absent
    today since the scan prompt doesn't yet request it) is parsed when
    present, falling back to DEFAULT_CONFIDENCE_LLM.
    """
    out: list[Violation] = []
    for v in raw_violations:
        try:
            confidence = float(v.get("confidence", DEFAULT_CONFIDENCE_LLM))
        except (TypeError, ValueError):
            confidence = DEFAULT_CONFIDENCE_LLM
        out.append(
            Violation(
                standard_id=v.get("standard_id", ""),
                rule=v.get("rule", ""),
                issue=v.get("issue", ""),
                suggestion=v.get("suggestion", ""),
                source="llm",
                confidence=confidence,
            )
        )
    return out


def _parse_llm_passes(raw_passes: list[dict]) -> list[PassedStandard]:
    """Convert raw LLM pass dicts to PassedStandard objects."""
    return [
        PassedStandard(
            standard_id=p.get("standard_id", ""),
            rule=p.get("rule", ""),
        )
        for p in raw_passes
    ]


# ---------------------------------------------------------------------------
# Public API: three entry points for three use cases
# ---------------------------------------------------------------------------


def check(
    text: str,
    content_type: str | None = None,
    model: str = DEFAULT_MODEL,
    use_llm_classifier: bool = True,
    audience: Audience | str = Audience.PRODUCT_UI,
    moment: str | None = None,
) -> tuple[CheckResult, float, TokenUsage]:
    """Full pipeline: classify → detect moment → filter → preprocess → scan → validate.

    This is the primary entry point for real-world usage.

    Args:
        text: The content to check.
        content_type: If provided, skips classification.
        model: Claude model for all LLM calls.
        use_llm_classifier: Use LLM for classification (True) or heuristic (False).
        audience: Content audience mode. Controls which standards are active.
            Accepts an Audience enum or a string ("product_ui", "general").
            Defaults to Audience.PRODUCT_UI (full standards enforcement).
        moment: If provided, skips moment detection and uses this value.
            Accepts any valid moment ID from MOMENT_TAXONOMY.
            If None, moment is auto-detected from text and content type.

    Returns:
        (CheckResult, total_latency, total_tokens)
    """
    _validate_text_input(text)

    # Normalize audience to enum if passed as string
    if isinstance(audience, str):
        audience = Audience.from_str(audience)

    standards_data = load_standards()
    rule_versions = _build_rule_version_map(standards_data)
    total_latency = 0.0
    total_tokens = TokenUsage()

    # Rationale chain — one hop appended per pipeline stage (v1.2.0).
    # Captures enough state per hop for a reviewer to pinpoint which
    # stage went sideways without re-running the pipeline.
    chain: list[RationaleHop] = []

    # Stage 1: Classify
    if content_type:
        detected_type = content_type
        chain.append(RationaleHop(
            step=HOP_CLASSIFY,
            inputs={"text_len": len(text), "classify_mode": "explicit"},
            output={"detected_type": detected_type},
        ))
    else:
        ct_descriptions = get_content_type_descriptions(standards_data)
        detected_type, cls_latency, cls_tokens = classify(
            text, content_types=ct_descriptions, model=model, use_llm=use_llm_classifier,
        )
        total_latency += cls_latency
        total_tokens += cls_tokens
        chain.append(RationaleHop(
            step=HOP_CLASSIFY,
            inputs={
                "text_len": len(text),
                "classify_mode": "llm" if use_llm_classifier else "heuristic",
                "candidates": len(ct_descriptions),
            },
            output={"detected_type": detected_type},
        ))

    # Stage 1b: Detect moment (Phase 1)
    # Runs after classification because the heuristic uses content_type.
    # Zero cost, <1ms. If moment was passed explicitly (Tier 3), skip detection.
    #
    # The confidence signal (Session 2) flips `review_reason` to
    # `situation_ambiguity` when the moment heuristic lacks a specific
    # pattern match. Explicit moments are treated as fully confident.
    if moment is None:
        detected_moment, moment_confidence = detect_moment_with_confidence(
            text, detected_type,
        )
        moment_mode = "detected"
    else:
        detected_moment = moment
        moment_confidence = 1.0
        moment_mode = "explicit"
    moment_ambiguous = moment_confidence < MOMENT_CONFIDENCE_THRESHOLD
    chain.append(RationaleHop(
        step=HOP_DETECT_MOMENT,
        inputs={
            "text_len": len(text),
            "content_type": detected_type,
            "mode": moment_mode,
        },
        output={
            "detected_moment": detected_moment,
            "ambiguous": moment_ambiguous,
        },
        confidence=moment_confidence,
    ))

    # Stage 2: Filter (audience-aware — suppresses UI-specific standards in general mode)
    filtered = filter_standards(standards_data, detected_type, audience=audience)
    active_notes = filtered.get("active_notes", [])
    filter_rule_versions = _build_rule_version_map(filtered)
    chain.append(RationaleHop(
        step=HOP_FILTER,
        inputs={
            "content_type": detected_type,
            "audience": audience.value,
            "total_standards": filtered.get("total_count", 0),
        },
        output={
            "filtered_count": filtered.get("filtered_count", 0),
            "active_notes_count": len(active_notes),
        },
        rule_versions=filter_rule_versions,
    ))

    # Stage 3a: Deterministic preprocess (content-type-aware)
    preprocess_violations = run_preprocess(text, detected_type)
    _stamp_rule_versions(list(preprocess_violations), rule_versions)
    preprocess_ids = {v.standard_id for v in preprocess_violations}
    suppressed_ids = getattr(preprocess_violations, 'suppressed_ids', set())
    chain.append(RationaleHop(
        step=HOP_PREPROCESS,
        inputs={"text_len": len(text), "content_type": detected_type},
        output={
            "violations_count": len(list(preprocess_violations)),
            "standards_fired": sorted(preprocess_ids),
            "suppressed_count": len(suppressed_ids),
        },
        confidence=1.0,  # deterministic
        rule_versions={
            sid: ver for sid, ver in rule_versions.items()
            if sid in preprocess_ids
        },
    ))

    # Stage 3b: LLM scan (audience + moment context injected into system prompt)
    scan_result, scan_latency, scan_tokens = _llm_scan(
        text, filtered, detected_type, model,
        audience=audience,
        moment=detected_moment,
    )
    total_latency += scan_latency
    total_tokens += scan_tokens

    llm_violations = _parse_llm_violations(scan_result.get("violations", []))
    llm_passes = _parse_llm_passes(scan_result.get("passes", []))
    _stamp_rule_versions(llm_violations, rule_versions)
    llm_scan_ids = sorted({v.standard_id for v in llm_violations})
    chain.append(RationaleHop(
        step=HOP_SCAN,
        inputs={
            "filtered_count": filtered.get("filtered_count", 0),
            "content_type": detected_type,
            "audience": audience.value,
            "moment": detected_moment,
        },
        output={
            "llm_candidates": len(llm_violations),
            "llm_passes": len(llm_passes),
            "standards_flagged": llm_scan_ids,
        },
        rule_versions={
            sid: ver for sid, ver in rule_versions.items()
            if sid in set(llm_scan_ids)
        },
    ))

    # Deduplicate: preprocess wins on conflicts
    # Also suppress LLM violations for standards the preprocessor definitively passed
    excluded_ids = preprocess_ids | suppressed_ids
    llm_candidates = [v for v in llm_violations if v.standard_id not in excluded_ids]

    # Stage 4: Validate
    if llm_candidates:
        confirmed, rejected, val_latency, val_tokens = validate_candidates(
            text, detected_type, llm_candidates,
            active_notes=active_notes, model=model,
        )
        _stamp_rule_versions(confirmed, rule_versions)
        _stamp_rule_versions(rejected, rule_versions)
        total_latency += val_latency
        total_tokens += val_tokens
    else:
        confirmed, rejected = [], []
    # Session 13: preserve both sides of every scan/validate
    # disagreement in the rationale chain. Reviewers see scan's
    # `issue` + `suggestion` alongside validate's rejection reason
    # without needing to re-run the pipeline.
    rejected_details = [
        {
            "standard_id": v.standard_id,
            "scan_issue": v.issue,
            "scan_suggestion": v.suggestion,
            "validate_rejection_reason": v.validate_rejection_reason,
        }
        for v in rejected
    ]
    chain.append(RationaleHop(
        step=HOP_VALIDATE,
        inputs={"candidate_count": len(llm_candidates)},
        output={
            "confirmed": len(confirmed),
            "rejected": len(rejected),
            "rejected_details": rejected_details,
        },
        rule_versions={
            sid: ver for sid, ver in rule_versions.items()
            if sid in {v.standard_id for v in confirmed + rejected}
        },
    ))

    # Stage 5: Merge
    #
    # Two suppression layers, applied in order:
    #
    # Layer 1 — Audience gate: suppress violations for UI-specific standards
    # in general mode. Handles cases where the preprocessor fires (e.g.,
    # PRF-03 trailing period on heading) but the standard isn't relevant
    # for non-UI content.
    #
    # Layer 2 — Moment gate (Phase 2): suppress violations for standards
    # that have a "suppress" weight in the detected moment. Handles cases
    # where a standard is relevant for the surface type but not for the
    # experiential context (e.g., PRF-11 "easy" in browsing_discovery).
    #
    # Both layers apply to preprocessor violations AND confirmed LLM violations.
    # The merge stage is the single point of truth for suppression policy.

    active_preprocess = [
        v for v in preprocess_violations
        if is_standard_active(v.standard_id, audience)
        and not is_standard_suppressed_by_moment(v.standard_id, detected_moment)
    ]

    active_confirmed = [
        v for v in confirmed
        if not is_standard_suppressed_by_moment(v.standard_id, detected_moment)
    ]

    # Count what was suppressed by moment for pipeline metadata
    moment_suppressed_count = sum(
        1 for v in (list(preprocess_violations) + confirmed)
        if is_standard_suppressed_by_moment(v.standard_id, detected_moment)
        and is_standard_active(v.standard_id, audience)
    )

    final_violations = active_preprocess + active_confirmed
    flagged_ids = {v.standard_id for v in final_violations}
    final_passes = [p for p in llm_passes if p.standard_id not in flagged_ids]

    # Collect moment metadata for triage
    moment_weights = get_moment_weights_applied(detected_moment)

    # Session 2: scan/validate disagreement is a review signal. The
    # scan proposed one or more candidates and the validate pass rejected
    # at least one — richest source for taxonomy refinement.
    scan_validate_disagreement = len(rejected) > 0

    overall = "fail" if final_violations else "pass"
    verdict, review_reason = derive_verdict(
        overall_verdict=overall,
        violations=final_violations,
        scan_validate_disagreement=scan_validate_disagreement,
        moment_ambiguous=moment_ambiguous,
    )

    chain.append(RationaleHop(
        step=HOP_MERGE,
        inputs={
            "preprocess_active": len(active_preprocess),
            "confirmed_active": len(active_confirmed),
            "audience_suppressed_preprocess": (
                len(list(preprocess_violations)) - len(active_preprocess)
            ),
            "moment_suppressed": moment_suppressed_count,
        },
        output={
            "final_violations": len(final_violations),
            "final_passes": len(final_passes),
            "overall_verdict": overall,
            "verdict": verdict,
            "review_reason": review_reason,
        },
        rule_versions={
            sid: ver for sid, ver in rule_versions.items()
            if sid in {v.standard_id for v in final_violations}
        },
    ))

    result = CheckResult(
        content_type=detected_type,
        overall_verdict=overall,
        verdict=verdict,
        review_reason=review_reason,
        violations=final_violations,
        passes=final_passes,
        summary=scan_result.get("summary", ""),
        audience=audience.value,
        moment=detected_moment,
        pipeline=PipelineMeta(
            standards_checked=filtered.get("filtered_count", 0),
            standards_total=filtered.get("total_count", 0),
            preprocess_violations=len(active_preprocess),
            llm_candidates=len(llm_candidates),
            validated_confirmed=len(active_confirmed),
            validated_rejected=len(rejected),
            moment_weights_applied=len(moment_weights),
            moment_suppressed=moment_suppressed_count,
        ),
        rationale_chain=chain,
    )

    return result, total_latency, total_tokens


def check_unfiltered(
    text: str,
    model: str = DEFAULT_MODEL,
) -> tuple[CheckResult, float, TokenUsage]:
    """Preprocess + single LLM call with all standards. No filtering, no validation.

    Used for library evals where synthetic test strings need the full rulebook
    without content type context. No moment detection — eval cases test
    standards in isolation, not in experiential context.
    """
    _validate_text_input(text)

    standards_data = load_standards()
    rule_versions = _build_rule_version_map(standards_data)
    chain: list[RationaleHop] = []

    # Deterministic preprocess
    preprocess_violations = run_preprocess(text)
    _stamp_rule_versions(list(preprocess_violations), rule_versions)
    preprocess_ids = {v.standard_id for v in preprocess_violations}
    suppressed_ids = getattr(preprocess_violations, 'suppressed_ids', set())
    chain.append(RationaleHop(
        step=HOP_PREPROCESS,
        inputs={"text_len": len(text), "content_type": "unfiltered"},
        output={
            "violations_count": len(list(preprocess_violations)),
            "standards_fired": sorted(preprocess_ids),
            "suppressed_count": len(suppressed_ids),
        },
        confidence=1.0,
        rule_versions={
            sid: ver for sid, ver in rule_versions.items()
            if sid in preprocess_ids
        },
    ))

    # LLM scan with full standards, no content type
    scan_result, latency, tokens = _llm_scan(
        text, standards_data, "unfiltered", model,
    )

    llm_violations = _parse_llm_violations(scan_result.get("violations", []))
    llm_passes = _parse_llm_passes(scan_result.get("passes", []))
    _stamp_rule_versions(llm_violations, rule_versions)
    llm_scan_ids = sorted({v.standard_id for v in llm_violations})
    chain.append(RationaleHop(
        step=HOP_SCAN,
        inputs={
            "filtered_count": standards_data.get("total_standards", 47),
            "content_type": "unfiltered",
            "audience": "product_ui",
            "moment": "",
        },
        output={
            "llm_candidates": len(llm_violations),
            "llm_passes": len(llm_passes),
            "standards_flagged": llm_scan_ids,
        },
        rule_versions={
            sid: ver for sid, ver in rule_versions.items()
            if sid in set(llm_scan_ids)
        },
    ))

    # Merge (no validation, no moment, no audience)
    # Post-processing suppression: exclude both preprocess violation IDs
    # and standards the preprocessor definitively passed
    excluded_ids = preprocess_ids | suppressed_ids
    llm_only = [v for v in llm_violations if v.standard_id not in excluded_ids]
    final_violations = list(preprocess_violations) + llm_only
    flagged_ids = {v.standard_id for v in final_violations}
    final_passes = [p for p in llm_passes if p.standard_id not in flagged_ids]

    overall = "fail" if final_violations else "pass"
    verdict, review_reason = derive_verdict(
        overall_verdict=overall, violations=final_violations,
    )

    chain.append(RationaleHop(
        step=HOP_MERGE,
        inputs={
            "preprocess_active": len(list(preprocess_violations)),
            "confirmed_active": len(llm_only),
        },
        output={
            "final_violations": len(final_violations),
            "final_passes": len(final_passes),
            "overall_verdict": overall,
            "verdict": verdict,
            "review_reason": review_reason,
        },
        rule_versions={
            sid: ver for sid, ver in rule_versions.items()
            if sid in flagged_ids
        },
    ))

    result = CheckResult(
        content_type="unfiltered",
        overall_verdict=overall,
        verdict=verdict,
        review_reason=review_reason,
        violations=final_violations,
        passes=final_passes,
        summary=scan_result.get("summary", ""),
        pipeline=PipelineMeta(
            standards_checked=standards_data.get("total_standards", 47),
            standards_total=standards_data.get("total_standards", 47),
            preprocess_violations=len(preprocess_violations),
            llm_candidates=len(llm_only),
        ),
        rationale_chain=chain,
    )

    return result, latency, tokens

