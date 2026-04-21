# ContentRX evaluation protocol

Read this before running any eval session. This document defines the 4-phase
protocol for building and maintaining the human-annotated evaluation corpus.
Every eval session follows these phases in order. No phase can be skipped.

## Why this protocol exists

ContentRX's accuracy depends on a calibrated loop: the machine makes verdicts,
humans validate them, and disagreements drive architectural improvements. The
eval corpus is the permanent record of that calibration. Without it, accuracy
claims are unmeasurable and improvements are unverifiable.

The JSON checkpoint is the deliverable, not the code. This protocol exists
because 87 Apple eval cases were lost by jumping to code patches before saving
extraction output. The rule is structural, not optional.

## Eval case schema

Every case in the corpus uses this schema. Fields marked (Phase 1) are filled
by the machine. Fields marked (Phase 2) are filled by the human annotator.

```json
{
  "text": "The actual UI string being evaluated",
  "content_type": "error_message",
  "standard_id": "CLR-01",
  "category": "clarity",
  "expected": "fail",
  "source_url": "https://example.com/page",
  "source_org": "Acme Corp",
  "domain": "fintech",
  "audience": "product_ui",

  "human_verdict": "fail",
  "human_confidence": "high",
  "human_notes": "First-person annotation explaining the reasoning",
  "review_status": "approved",
  "triage_category": "correct"
}
```

### Field definitions

| Field | Phase | Required | Values |
|---|---|---|---|
| `text` | 1 | yes | The raw string under evaluation |
| `content_type` | 1 | yes | One of the pipeline's content types |
| `standard_id` | 1 | yes | The primary standard being tested (e.g., CLR-01) |
| `category` | 1 | yes | The standard's parent category |
| `expected` | 1 | yes | `pass` or `fail` — the machine's call |
| `source_url` | 1 | if available | Where the string was extracted from |
| `source_org` | 1 | if available | The organization that published the content |
| `domain` | 1 | yes | `healthcare`, `fintech`, `ecommerce`, `marketing`, etc. |
| `audience` | 1 | yes | `product_ui` or `general` |
| `human_verdict` | 2 | yes | `pass` or `fail` — the human's call. Never null (except excluded) |
| `human_confidence` | 2 | yes | `high`, `medium`, or `low` |
| `human_notes` | 2 | yes | First-person reasoning. The most valuable field in the corpus |
| `review_status` | 2 | yes | `approved`, `revised`, `excluded`, or `flagged` |
| `triage_category` | 2 | yes | `correct`, `misclassification`, `hallucination`, `missing_standard`, `context_gap` |

### Triage categories (from ARCHITECTURE.md)

| Category | Machine got it... | Architectural response |
|---|---|---|
| `correct` | Right | None needed |
| `misclassification` | Wrong content type | Classifier improvement |
| `hallucination` | Invented a violation | LLM/validation tuning |
| `missing_standard` | Right but for wrong reason | Standards library gap |
| `context_gap` | Wrong due to missing context | Audience signal, moments, etc. |

---

## Phase 1: Machine annotation

**Goal:** Generate machine verdicts for all cases and save a checkpoint.

### Input sources

Content enters the eval pipeline from one of these paths:

1. **URL extraction** — `tools/extract_content.py` scrapes a live site
2. **Screenshot extraction** — Claude reads uploaded screenshots and structures the content
3. **Direct input** — user pastes strings directly into chat
4. **Triage promotion** — high-signal cases from `tools/triage.py` exports

### What Claude does in Phase 1

1. Receives raw content (strings, screenshots, or URLs)
2. For each string:
   - Classifies content type (heuristic or LLM)
   - Detects moment (Tier 1 heuristic)
   - Identifies the primary standard and expected verdict
   - Determines the triage category the machine would assign
   - Writes the Phase 1 fields into the case object
3. Saves the complete JSON to disk as a checkpoint file
4. Reports extraction stats: total cases, content type distribution,
   standard distribution, pass/fail split

### Checkpoint discipline

The JSON checkpoint is saved BEFORE any Phase 2 discussion begins. The file
is the deliverable. If the session ends unexpectedly, the checkpoint survives.

File naming: `{domain}_eval_cases.json` (e.g., `healthcare_eval_cases.json`)
Location: `/mnt/user-data/outputs/` for download

### What Claude does NOT do in Phase 1

- Does not debate verdicts
- Does not suggest code changes
- Does not skip to interesting cases
- Does not modify standards or pipeline logic

---

## Phase 2: Human annotation (structured input workflow)

**Goal:** Fill all human annotation fields for every case. No case exits
this phase with `human_verdict: null` (except excluded cases).

Phase 2 uses the `ask_user_input` tool to minimize typing. The human expert
taps for agreements (~80% of cases) and types only for overrides (the
high-signal ~20%).

### Step 1: Batch approval for clean cases

Claude identifies cases where the machine verdict is clear-cut — obvious
passes and obvious violations with no ambiguity. These are presented as a
batch:

1. Claude states the count and the shared reasoning pattern
2. Claude presents a structured input:
   - **[Approve all]** / **[Let me review individually]**
3. If "Approve all":
   - `human_verdict` = machine's call
   - `human_confidence` = `"high"`
   - `human_notes` = auto-generated from Claude's reasoning, written in
     first person as the human annotator would say it
   - `review_status` = `"approved"`
   - `triage_category` = Claude's proposed category
4. If "Let me review": Claude falls back to the individual annotation
   card flow (Step 2)

### Step 2: Difficult cases in clusters of 3

Cases requiring human judgment are presented as annotation cards with full
reasoning visible, then grouped into structured input clusters of 3
(the tool's limit per question set).

Each question shows: case number, text excerpt, Claude's call + standard.

Options vary based on Claude's call:
- If Claude called **fail**: [Agree — fail] / [Override — pass] / [Skip]
- If Claude called **pass**: [Agree — pass] / [Override — fail] / [Skip]

After each cluster, Claude asks:
> "Want to add or correct any notes before I checkpoint?"

This is the optional free-text escape hatch. Most of the time, the user
says "no" or "all good" and moves on.

### Agree flow (no typing required)

When the user taps "Agree":
- `human_verdict` = Claude's call
- `human_confidence` = `"high"`
- `human_notes` = Claude's reasoning, written in first person
- `review_status` = `"approved"`
- `triage_category` = Claude's proposed category

### Override flow (typing required — this is the high-signal path)

When the user taps "Override":

1. Claude presents a confidence selector:
   - **[High]** / **[Medium]** / **[Low]**
2. Claude asks: "What's your reasoning?"
   - User types free-text rationale
3. Claude writes the annotation:
   - `human_verdict` = opposite of Claude's call
   - `human_confidence` = user's selection
   - `human_notes` = user's exact words (never paraphrased)
   - `review_status` = `"revised"`
   - `triage_category` = Claude asks if the proposed category still applies

### Skip flow (rare — for excluded cases only)

When the user taps "Skip":
- `human_verdict` = null (the only case where null is allowed)
- `review_status` = `"excluded"`
- `human_notes` = `"Excluded — "` + reason prompted from user

### Checkpoint cadence

Save a checkpoint every 10–15 cases during Phase 2. Each checkpoint
overwrites the file with the current state. If the session ends mid-phase,
the most recent checkpoint preserves all completed annotations.

### What makes a good human_notes entry

`human_notes` is the most valuable field in the corpus. It's what future
sessions use to calibrate the auto-annotator and what disambiguates close
calls. Good notes explain the *why*, not just the *what*:

- **Strong:** "This is a marketing headline where the trailing period creates
  rhythmic cadence — 'Dream it up. Jot it down.' — not a punctuation error.
  The audience=general mode would suppress PRF-03 correctly."
- **Weak:** "Disagree with the machine."
- **Strong:** "The word 'simply' here is dismissive because the user just
  hit an error. Telling them to 'simply try again' minimizes the friction."
- **Weak:** "PRF-11 violation."

---

## Phase 3: Quality audit

**Goal:** Verify the corpus has no gaps before it becomes permanent.

### Null-field audit

Claude scans every case for:
- `human_verdict` = null (must be filled unless `review_status` = `"excluded"`)
- `human_confidence` = null
- `human_notes` = null or empty string
- `triage_category` = null

Any nulls are flagged and must be resolved before proceeding. Claude
presents the gaps and the user fills them via the structured input flow.

### Consistency checks

- Cases with `review_status: "revised"` must have `human_notes` explaining
  the override (auto-generated notes are insufficient for overrides)
- Cases with `human_confidence: "low"` should be reviewed for potential
  exclusion or for additional notes explaining the uncertainty
- Pass/fail distribution should be roughly balanced. Heavy skew toward
  one verdict suggests sampling bias in the source content

### Final checkpoint

After the audit passes, save the final JSON. This version is the one that
gets added to the permanent eval corpus at `evals/industry/`.

---

## Phase 4: Architectural analysis

**Goal:** Extract actionable findings from the eval data.

This phase is where eval results drive engineering decisions. Claude
analyzes the completed corpus and identifies:

### Pattern identification

- **Systematic failures:** 3+ cases with the same triage category for the
  same standard. These are architectural gaps, not one-off errors.
- **Context gaps:** Cases where the tool lacks information it needs (audience,
  moment, frame context). These inform feature priorities.
- **Moment audit:** Which moments were detected? Which were missed? Are
  moment weights producing the expected behavior?
- **Preprocessor coverage:** Which standards would benefit from a new
  deterministic check? The threshold is 3+ cases where a simple regex
  would have caught the violation without LLM cost.

### Output

Phase 4 produces:
1. A stats summary (total cases, accuracy, breakdown by triage category)
2. A prioritized patch queue (specific code changes, ordered by impact)
3. An updated session summary for memory carry-over
4. File destinations for every output artifact

### What Phase 4 does NOT do

- Does not implement code changes (those happen in a follow-up session)
- Does not modify the eval corpus (that was locked in Phase 3)
- Does not run the eval runner (that happens when patches land)

---

## Session hygiene

### Context check-in

After every 3rd evaluation or major build block, proactively check context
length. When wrapping a session, always produce a full context summary:

1. What was built and where files go
2. What carries over (patch queue, corpus additions, open questions)
3. What the next session should start with
4. Every output file with its exact destination path

### What the next session starts with

1. Read `ARCHITECTURE.md`
2. Read this document (`EVAL_PROTOCOL.md`)
3. Verify preprocessor, moments, and standards counts
4. Apply any pending patches from the previous session's queue
5. Run `python3 -m pytest tests/ -v` to confirm green

### Versioning

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-03-28 | Initial 4-phase protocol |
| 1.1 | 2026-03-29 | Added checkpoint discipline (Apple case loss) |
| 2.0 | 2026-04-01 | Structured input amendment integrated. Batch approvals, annotation clusters, override flow, skip flow. Consolidation of base protocol and amendment into single document |
