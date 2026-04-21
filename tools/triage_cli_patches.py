"""
Patches for tools/triage.py to support triage_assist.py suggestions.

Apply these three changes to your existing triage.py. They're surgical —
no other code changes needed.
"""

# ═══════════════════════════════════════════════════════════════════════
# PATCH 1: Show suggestion in case display
#
# Location: render_case_display(), after the violations section
# Find the line:  lines.append(_hr())  (the LAST one, around line 195)
# Add BEFORE that final _hr():
# ═══════════════════════════════════════════════════════════════════════

"""
    # Suggestion from triage assist (if present)
    suggested_cat = case.get("suggested_category")
    if suggested_cat:
        suggested_conf = case.get("suggested_confidence", "?")
        suggested_notes = case.get("suggested_notes", "")
        lines.append(
            f"{C.MAGENTA}Suggestion:{C.RESET} {suggested_cat} "
            f"({suggested_conf})"
        )
        if suggested_notes:
            lines.append(f"  {C.DIM}{suggested_notes}{C.RESET}")
        lines.append("")
"""


# ═══════════════════════════════════════════════════════════════════════
# PATCH 2: Use suggested_confidence as default
#
# Location: review_case(), Step 2 (confidence prompt), around line 712
#
# REPLACE:
#     confidence = prompt_choice(
#         "Confidence?",
#         CONFIDENCE_LEVELS,
#         shortcuts={"h": "high", "m": "medium", "l": "low"},
#         default="high" if agree_result == "yes" else "medium",
#     )
#
# WITH:
# ═══════════════════════════════════════════════════════════════════════

"""
    # Use suggestion as default if available, otherwise original logic
    suggested_conf = case.get("suggested_confidence")
    if suggested_conf and suggested_conf in CONFIDENCE_LEVELS:
        conf_default = suggested_conf
    else:
        conf_default = "high" if agree_result == "yes" else "medium"
    confidence = prompt_choice(
        "Confidence?",
        CONFIDENCE_LEVELS,
        shortcuts={"h": "high", "m": "medium", "l": "low"},
        default=conf_default,
    )
"""


# ═══════════════════════════════════════════════════════════════════════
# PATCH 3: Use suggested_category as default
#
# Location: review_case(), Step 3 (category prompt), around line 724
#
# REPLACE:
#     cat_default = "correct" if agree_result == "yes" else None
#
# WITH:
# ═══════════════════════════════════════════════════════════════════════

"""
    # Use suggestion as default if available
    suggested_cat = case.get("suggested_category")
    if suggested_cat and suggested_cat in TRIAGE_CATEGORIES:
        cat_default = suggested_cat
    elif agree_result == "yes":
        cat_default = "correct"
    else:
        cat_default = None
"""
