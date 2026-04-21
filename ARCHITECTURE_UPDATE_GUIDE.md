# ARCHITECTURE.md update guide — v4.5.1 → v4.6.0

Apply these surgical edits to ARCHITECTURE.md after copying the 4 output files.

---

## 1. Moment table: 12 → 13

In the "13 canonical moments" section (was "12 canonical moments"), add
this row after `wayfinding`:

| `compliance_disclosure` | Regulatory disclaimers, FDIC notices, legal mandates. Mandated language takes precedence. | 2 |

Update the section header from "The 12 canonical moments" to "The 13 canonical moments".

Update the count: "19 of 46 standards have at least one moment weight. 55 total
weight entries" → "19 of 47 standards have at least one moment weight. 57 total
weight entries" (added CON-02 suppress + CLR-01 relax = +2).

---

## 2. Add compliance_disclosure documentation section

After the "Trust/permission moment (v4.4.2)" section, add:

### Compliance disclosure moment (v4.6.0)

Regulatory disclaimers use mandated language that content standards shouldn't
override. "Not Insured by the FDIC" uses Title Case by convention — CON-02
should not flag it. "Qualification period" is legally mandated precision, not
jargon — CLR-01 should tolerate it.

Detected by signals like "FDIC," "FINRA," "SEC" (word-bounded to avoid
"section"/"secure"), "not insured," "investment products," "terms and
conditions," "qualification period," "may lose value," "not a deposit."

Priority: checked AFTER task_execution but BEFORE browsing_discovery. Less
specific than task patterns, but must be caught before the default absorbs it.
Short ui_labels (≤4 words) with compliance signals will be caught by wayfinding
first — this is correct because the classifier should route those as
short_ui_copy, not ui_label.

| Standard | Weight | Why |
|---|---|---|
| CON-02 | suppress | Regulatory disclaimers use Title Case by convention or legal mandate |
| CLR-01 | relax | Legal and financial terms may be mandated precision, not jargon |

Evidence: WF-011 (FINRA disclaimer Title Case), WF-012 (FDIC disclosure
Title Case), WF-017 ("qualification period" is mandated, not jargon).

---

## 3. Detection priority order: add position 12

Update the detection priority list:

```
11. task_execution
12. compliance_disclosure (v4.6.0)
13. browsing_discovery (default fallback)
```

---

## 4. Filter _global note fix

In the "Data flow" section, Stage 2 description, add:

```
├─ Stage 2: filter (filter.py)
│     Prunes standards library by content type using relevant_content_types
│     + audience gate: excludes UI-specific standards in general mode
│     Returns filtered standards + active content_type_notes
│     (includes _global notes that apply regardless of content type)
```

---

## 5. Preprocessor count

The data flow diagram says "23 deterministic checks" in one place and "25
deterministic checks" in another. Verify the actual count in preprocess.py
and make all references consistent.

---

## 6. Standards count

If any reference says "46 standards," update to "47 standards" (GRM-06 was
added in a prior session).

---

## 7. PATCH_QUEUE.md updates

Mark P1 and P2 as complete:

```
## P1: Build compliance_disclosure moment
**Status:** Complete (v4.6.0). Shipped in moments.py, 64 tests.

## P2: TRN-04 content_type_notes refinement
**Status:** Complete (v4.6.0). Surgical patch applied. Filter _global bug
also fixed (CLR-01 _global was dead code since v4.4.x).
```
