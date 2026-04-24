# Annual taxonomy audit — {year}

*Generated {timestamp}. Panel: {N} cases, {M} scored pairs.*

## Top line

- Cohen's κ = **{kappa}** (95% CI [{ci_low}, {ci_high}])
- Overall agreement: {agreement}
- Audit band: `{band}` (`stable` ≥ 0.80 · `watch` ≥ 0.65 · `material_drift` < 0.65)
- Design target: κ = 0.90

## Ceiling recommendation

{One of: "Keep the 0.90 design target as-is for the coming year."
/ "Ceiling is defensible but tight — revisit mid-year if quarterly
drift weakens." / "Lower the graduation target to the measured
ceiling; thresholds move with the measurement, not the target."}

## Standards with highest past/present disagreement

The top 10 standards whose verdicts changed between past-Robo and
current-Robo. A high disagreement rate on a single standard could be:

1. **Intentional drift** — the standard was refined (check the
   `version_history`); past verdicts should no longer be trusted at
   face value.
2. **Unintentional drift** — overfit to recent cases. Flag for
   refinement-log review.
3. **Small-n noise** — the sample for this standard is <5 pairs;
   the rate is not informative. Note and move on.

| Standard | Count | Disagreements | Rate |
|---|---:|---:|---:|
| `...` | N | M | R% |

## Moments with most evolution

Top 10 moments by disagreement rate. Same three-way read as standards:
intentional drift (moment refined), unintentional drift (overfit),
or small-n noise.

| Moment | Count | Disagreements | Rate |
|---|---:|---:|---:|
| `...` | N | M | R% |

## Retired standards that might deserve reinstatement

Standards that appeared on the panel's historical verdicts but are
absent from the current library. For each:

- Was the retirement explicit (refinement log entry) or implicit
  (fell out of the library without being logged)?
- Does the historical pattern reveal a use case the current library
  doesn't cover?
- If yes, draft a Proposed refinement entry in
  `taxonomy_refinement_log.md` recommending reinstatement or a
  narrowed replacement.

## New-moment candidates

Cases where the historical moment is no longer in the taxonomy, or
where re-label diverged on moment detection specifically. For each:

- Is the moment genuinely missing from the taxonomy, or is this a
  misclassification?
- Accumulate enough of these (two-source minimum; verdict-impact
  test) and propose a new-moment refinement.

## Next year's taxonomy roadmap

Robo fills this in by hand. One or two sentences per priority. The
scored sections above are the inputs; this section is the output —
what Robo plans to do with the audit's findings.

- **Priority 1:** ...
- **Priority 2:** ...
- **Priority 3:** ...

## Audit metadata

- Panel manifest: `evals/annual_audit/panels/{year}.json`
- Labels: `evals/annual_audit/labels/{year}.json`
- Scored report: `evals/annual_audit/reports/{year}.json`
- Min age filter: 365 days
- Design target: κ = 0.90
- Quarterly-drift counterpart (for cross-reference):
  `evals/drift/reports/{year}-q1.json` through `-q4.json`
