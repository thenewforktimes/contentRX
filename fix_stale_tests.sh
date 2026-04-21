#!/bin/bash
# fix_stale_tests.sh — Updates test expectations for v4.5.1
#
# Fixes 13 stale assertions across 7 test files.
# Run from the project root (content-standards-checker/).
#
# What changed:
#   - GRM-06 added 1 standard → filter counts +1, total 46→47
#   - GRM-06 added 1 preprocessor function → check count 24→25
#   - celebration + trust_permission added → moment count 10→12
#   - CON-02 weight added to celebration → weight count 5→6

set -e

echo "Fixing stale test expectations..."

# --- Preprocessor check count: 24 → 25 (GRM-06 added a function) ---

# test_apple_patches.py — TestPreprocessIntegration::test_check_count_24
sed -i '' 's/assert len(results) == 24/assert len(results) == 25/' tests/test_apple_patches.py

# test_preprocess.py — TestPreprocessIntegrationFull::test_returns_all_13_checks
sed -i '' 's/assert len(results) == 24/assert len(results) == 25/' tests/test_preprocess.py

# test_preprocess_phase2.py — TestPreprocessIntegration::test_total_check_count
sed -i '' 's/assert len(results) == 24/assert len(results) == 25/' tests/test_preprocess_phase2.py

# test_preprocess_phase3.py — TestPreprocessIntegration::test_total_check_count
sed -i '' 's/assert len(results) == 24/assert len(results) == 25/' tests/test_preprocess_phase3.py


# --- Filter standard counts: +1 for each type GRM-06 applies to ---
# GRM-06 is relevant to: error_message, confirmation, tooltip_microcopy,
# short_ui_copy, long_form_copy (but NOT button_cta, NOT ui_label)

sed -i '' 's/("error_message", 21)/("error_message", 22)/' tests/test_filter.py
sed -i '' 's/("confirmation", 17)/("confirmation", 18)/' tests/test_filter.py
sed -i '' 's/("tooltip_microcopy", 23)/("tooltip_microcopy", 24)/' tests/test_filter.py
sed -i '' 's/("short_ui_copy", 37)/("short_ui_copy", 38)/' tests/test_filter.py
sed -i '' 's/("long_form_copy", 37)/("long_form_copy", 38)/' tests/test_filter.py

# Total standards count: 46 → 47
sed -i '' 's/result\["total_count"\] == 46/result["total_count"] == 47/' tests/test_filter.py


# --- Moment taxonomy count: 10 → 12 (celebration + trust_permission) ---
sed -i '' 's/assert len(MOMENT_TAXONOMY) == 10/assert len(MOMENT_TAXONOMY) == 12/' tests/test_moments_pipeline.py


# --- Celebration weight count: 5 → 6 (CON-02 added) ---
sed -i '' 's/assert len(get_moment_weights("celebration")) == 5/assert len(get_moment_weights("celebration")) == 6/' tests/test_v442_patches.py


echo "Done. Run: python3 -m pytest tests/ -v"
