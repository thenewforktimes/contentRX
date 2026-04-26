"""Content standards checker — an open source linter for UX and UI copy.

Usage:
    from content_checker import check, check_unfiltered, check_batch

    # Single string
    result, latency, tokens = check("Click here to learn more")
    print(result.overall_verdict)  # "fail"

    # Batch (Figma multi-select, code scanner output)
    from content_checker.models import ContentItem
    items = [
        ContentItem("Go to Settings", label="Nav link"),
        ContentItem("Open the Preferences panel", label="Help text"),
    ]
    batch = check_batch(items)
    print(batch.overall_verdict)  # "fail" (terminology inconsistency)
"""

from content_checker.batch import check_batch
from content_checker.pipeline import check, check_unfiltered
from content_checker.standards.loader import load_standards

__version__ = "4.7.0"

__all__ = ["check", "check_unfiltered", "check_batch", "load_standards", "__version__"]
