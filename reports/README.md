# Reports

Public artifacts produced by scheduled generators that read substrate
data and emit markdown / JSON. The docs site renders these; the
founder previews them at `/admin/reports` before publishing.

See [decisions/2026-04-25-private-taxonomy-pivot.md](../decisions/2026-04-25-private-taxonomy-pivot.md)
for the substrate-to-report contract and the rationale behind it.

## Subdirectories

### `accuracy/`

Nightly accuracy snapshot. The generator emits one rolling file:

```
accuracy/latest.json
```

Schema: per-standard kappa with 95% CI, system-level kappa with 95%
CI, design target stated separately. Numbers only — no narrative.
Consumed by the public `/accuracy` page.

### `calibration/`

Weekly calibration log. The generator runs every Monday at 14:00 UTC
and emits one markdown file per ISO week:

```
calibration/2026-WW.md
```

Schema: kappa movement vs prior week, drift detection signals,
override count by subtype, most active refinement-log entries. The
narrative tone is templated, not hand-written — consistency-of-format
across weeks is what makes drift detectable.

### `quarterly/`

Quarterly accuracy reports. The generator runs on the first Monday of
each quarter and emits one markdown scaffold per quarter:

```
quarterly/YYYY-Q.md
```

Schema: scaffold with all numbers populated and section headers in
place. The narrative is hand-edited by the founder before publishing.

## Operational discipline

- Public report templates are version-controlled. Changes to a
  template require regenerating the last four weeks of reports
  against the new template and visually inspecting for unintended
  formatting drift.
- A staleness monitor checks the most recent timestamp on each
  subdirectory once per day; if a generator hasn't produced output in
  8 days (one day past the cron cycle), it pages.
- Stale reports are worse than no reports for the named-expert moat —
  the moat depends on continuity of evidence.

The generators themselves ship in **Phase C**. Phase B6 ships the
preview-before-publish gate at `/admin/reports`.
