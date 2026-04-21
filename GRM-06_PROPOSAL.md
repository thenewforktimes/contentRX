# GRM-06: Compound modifier hyphenation
#
# Proposed new standard for the content standards library.
# Preprocessor-eligible: mechanical check, binary outcome.


## The rule

Hyphenate number-unit compound modifiers before nouns. The unit
takes singular form when hyphenated.

    PASS: "5-day streak", "30-day trial", "2-hour workshop"
    FAIL: "5 day streak", "5 days streak", "30 day trial", "2 hour workshop"
    DEFER: "in 5 days" (not a compound modifier — standalone quantity)


## Why this belongs in the preprocessor

1. Binary outcome. If number + unit + noun has no hyphen, it's wrong. No context changes the answer.
2. Zero judgment. Unlike "should this be a numeral?" (GRM-05), hyphenation of compound modifiers is a grammar rule with no exceptions in UI copy.
3. High frequency. Every app with time-based features produces these: trial periods, streaks, countdowns, deadlines, durations.
4. Real-world evidence. The freud app has "5 days streak" and "10 days streak" — same error twice, which means it's systemic in the codebase.


## Preprocessor check design

```python
# Units that commonly appear in compound modifiers
_COMPOUND_MOD_UNITS = (
    "day", "week", "month", "year",
    "hour", "minute", "second",
    "step", "page", "word",
    "mile", "foot", "inch", "pound",
    "dollar", "percent",
)

# Build pattern: \b\d+\s+(?:days?|weeks?|...)\s+(?!of|in|to|for|from|ago|later|or|and)(\w+)\b
# The negative lookahead excludes "5 days of treatment" (not a compound modifier).
# The trailing \w+ must be a noun — approximated by excluding prepositions/conjunctions.

_COMPOUND_UNITS_RE = "|".join(
    rf"{u}s?" for u in _COMPOUND_MOD_UNITS
)

# Pattern 1: VIOLATION — number + unit + noun, no hyphen
# "5 day streak", "5 days streak", "30 day trial"
_UNHYPHENATED_COMPOUND = re.compile(
    rf"\b(\d+)\s+({_COMPOUND_UNITS_RE})\s+(?!of\b|in\b|to\b|for\b|from\b|ago\b|later\b|or\b|and\b)(\w{{2,}})\b",
    re.IGNORECASE,
)

# Pattern 2: PASS — number + hyphen + singular unit + noun
# "5-day streak", "30-day trial"
_HYPHENATED_COMPOUND = re.compile(
    rf"\b\d+-({"|".join(_COMPOUND_MOD_UNITS)})\s+\w+\b",
    re.IGNORECASE,
)
```

### Check logic

```python
def check_grm06_compound_modifiers(text: str) -> PreprocessResult:
    """GRM-06: Hyphenate number-unit compound modifiers before nouns."""

    # Check for correctly hyphenated compounds first (PASS)
    if _HYPHENATED_COMPOUND.search(text):
        return PreprocessResult(standard_id="GRM-06", outcome=Outcome.PASS)

    # Check for unhyphenated compounds (VIOLATION)
    match = _UNHYPHENATED_COMPOUND.search(text)
    if match:
        number = match.group(1)
        unit = match.group(2)
        # Normalize unit to singular for the suggestion
        singular = unit.rstrip("s") if unit.endswith("s") and unit not in ("process",) else unit
        return PreprocessResult(
            standard_id="GRM-06",
            outcome=Outcome.VIOLATION,
            issue=f"Compound modifier '{number} {unit}' needs a hyphen before the noun.",
            suggestion=f"Use '{number}-{singular}' with a hyphen and singular unit.",
        )

    return PreprocessResult(standard_id="GRM-06", outcome=Outcome.DEFER)
```

### Safe contexts (things that look like compound modifiers but aren't)

- "in 5 days" — standalone duration, not modifying a noun
- "5 days of treatment" — prepositional phrase, not compound modifier
- "over 5 days" — adverbial phrase
- "5 days ago" — relative time
- "within 5 days" — prepositional phrase

The negative lookahead on prepositions handles most of these. Edge cases
where the following word IS a noun but the phrase is still not a compound
modifier (e.g., "I waited 5 days, streaks are hard") would need sentence
boundary detection — defer those to the LLM.


### What this catches from the eval corpus

From freud mental health app:
- "Reach 10 days streak to unlock." → FAIL ("10-day streak")
- "Congratulations on reaching 5 days streak!" → FAIL ("5-day streak")

From Opendoor triage (hypothetical):
- "2 day turnaround" → FAIL ("2-day turnaround")
- "30 day trial" → FAIL ("30-day trial")

Would NOT flag:
- "in 5 days" (preposition before number)
- "5 days remaining" (remaining is not a noun being modified)
- "Completed 5 days ago" (ago in exclusion list)


## Standards library entry

```json
{
    "id": "GRM-06",
    "rule": "Hyphenate number-unit compound modifiers before nouns. The unit takes singular form when hyphenated.",
    "correct": "Start your 30-day free trial. | We offer a 2-hour workshop.",
    "incorrect": "Start your 30 day free trial. | We offer a 2 hours workshop.",
    "rule_type": "mechanical",
    "checkable_from": "plain_text",
    "relevant_content_types": [
        "short_ui_copy", "long_form_copy", "heading",
        "tooltip_microcopy", "error_message", "confirmation"
    ]
}
```


## Moment weights

No moment-specific weights initially. Compound modifier hyphenation is
universal — it doesn't change based on whether the user is celebrating,
recovering from an error, or making a decision. The hyphen is always required.


## Open questions

1. Should this check also catch non-numeric compound modifiers?
   "a one time offer" → "a one-time offer"
   This overlaps with GRM-05 safe contexts. Probably keep separate for now.

2. What about ordinal compounds? "a first time user" → "a first-time user"
   Harder to detect mechanically. Defer to LLM initially.

3. Units like "person" or "member"? "a 5 person team" → "a 5-person team"
   The unit list should be expandable. Start conservative, add from triage.
