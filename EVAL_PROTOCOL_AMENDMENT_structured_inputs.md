# EVAL_PROTOCOL amendment: structured input annotation workflow

Effective: 2026-04-01. Applies to all future in-chat eval sessions.
Amends Phase 2 of EVAL_PROTOCOL.md. All other phases unchanged.

## What changed

Phase 2 human annotation now uses the `ask_user_input` tool instead of
free-text responses. This eliminates typing for ~80% of cases (agreements)
and focuses human effort on overrides, where the annotation signal is highest.

## Batch approval flow

For clean passes and clean violations (no discussion needed):

1. Claude presents the count and shared reasoning as text
2. Claude presents structured input:
   - [Approve all] / [Let me review individually]
3. "Approve all" → Claude batch-writes annotations with auto-generated human_notes
4. "Let me review" → Claude falls back to individual annotation cards

## Difficult case flow

For cases requiring human judgment:

1. Claude presents annotation cards as text (full reasoning visible)
2. Claude presents structured input in clusters of 3 (tool limit):
   - Each question shows: case number, text excerpt, Claude's call + standard
   - Options: [Agree — fail] / [Override — pass] / [Skip]
   - (Or [Agree — pass] / [Override — fail] / [Skip] when Claude called pass)
3. After each cluster, Claude asks: "Want to add or correct any notes before I checkpoint?"
   - This is the optional free-text escape hatch
   - Most of the time, user says "no" or "all good" and moves on

## Agree flow (no typing required)

When the user taps "Agree":
- `human_verdict` = Claude's call
- `human_confidence` = "high"
- `human_notes` = Claude's reasoning, written in first person as the human annotator
- `review_status` = "approved"
- `triage_category` = Claude's proposed category

## Override flow (typing required — this is the high-signal path)

When the user taps "Override":

1. Claude presents confidence selector:
   - [High] / [Medium] / [Low]
2. Claude asks: "What's your reasoning?"
   - User types free-text rationale
3. Claude writes the annotation:
   - `human_verdict` = opposite of Claude's call
   - `human_confidence` = user's selection
   - `human_notes` = user's exact words
   - `review_status` = "revised"
   - `triage_category` = asked if Claude's proposed category still applies

## Skip flow

When the user taps "Skip":
- `human_verdict` = null (allowed only for excluded cases)
- `review_status` = "excluded"
- `human_notes` = "Excluded — [reason prompted]"

## Why this is better

| Before | After |
|---|---|
| User types verdict for every case | User taps for agreements, types only for overrides |
| Copy-paste errors between cases | Each case gets its own tap |
| Human_notes often thin on agreements | Auto-generated from Claude's reasoning |
| Human_notes lost on overrides | Explicitly prompted and captured |
| ~5 min per cluster of 3 cases | ~30 sec per cluster of 3 agreements |

## What doesn't change

- The 4-phase protocol order is unchanged
- Phase 1 checkpoint must be saved before Phase 2 begins
- No case exits with human_verdict: null (except excluded)
- Checkpoints every 10-15 cases
- The null-field audit still runs before Phase 3
- human_notes remain the most valuable field in the corpus
