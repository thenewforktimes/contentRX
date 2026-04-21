# Patch queue

Generated from Robinhood + MEDVi eval session (2026-04-02). Read this
alongside ARCHITECTURE.md before implementing any patches.

## Source data

- Eval corpora: robinhood_eval_cases.json (44 cases), medvi_eval_cases.json (38 cases)
- Combined agreement rate: 83.0% (68/82)
- Overrides: 14 (13 machine-fail → human-pass, 1 machine-pass → human-fail)
- Hallucinations: 0 across 82 cases
- Context gap findings: 14 cases in 6 patterns

---

## Resolved in v4.6.1

### P1: VT-02 _global content_type_notes (We/Our framing)

**Status:** Complete (v4.6.1). Surgical JSON patch to standards_library.json.

**Evidence:** 7 cases across 2 corpora (RH-010, RH-011, RH-012, RH-018,
RH-022, MV-035, MV-036). The single strongest finding in the session.

**The line:** First-person "We/Our" framing is acceptable when the user is the
object or beneficiary and the company is making commitments about its own
behavior. In healthcare, "Our physicians" is clearer than "Your physician"
when the care relationship hasn't been established.

**Patch:** `_global` content_type_notes on VT-02 with user-centric
beneficiary test.

---

### P2: CLR-01 _global extension (domain-aware jargon)

**Status:** Complete (v4.6.1). Appended to existing _global note.

**Evidence:** 3 cases (MV-001/GLP-1, MV-010/GLP-1, MV-028/GLP-1 medications).
Contrasting case: RH-032 "Staking" correctly flagged as crypto jargon.

**The line:** Medical and financial terms that have entered mainstream awareness
through cultural discourse (GLP-1, FDIC, 401(k)) do not violate plain language.
Evaluate jargon relative to target audience and domain. Terms may be required
by regulatory constraints.

**Patch:** Extended existing CLR-01 _global note with failure mode (4).

---

### P3: VT-01 heading/short_ui_copy notes (passive trust claims)

**Status:** Complete (v4.6.1). Surgical JSON patch + relevant_content_types fix.

**Evidence:** 2 cases across 2 corpora (RH-008, MV-023).

**The line:** Passive voice is acceptable when it foregrounds a trust signal,
credential, or user benefit. "Trusted by 10,000 patients" and "Handled by the
pros" correctly foreground what matters to the user.

**Patch:** `heading` and `short_ui_copy` content_type_notes on VT-01.
Also added `heading` to VT-01's relevant_content_types — without this the note
was dead code (the filter excluded VT-01 for heading before the note was
collected).

**Architectural learning:** Every content_type_notes key (except _global) must
also appear in relevant_content_types or the note is unreachable. Invariant
test added to test_integration_seams.py.

---

### P4: CON-02 ui_label audience exemption

**Status:** Complete (v4.6.1). filter.py change with _AUDIENCE_CONTENT_TYPE_OVERRIDES.

**Evidence:** 1 case (RH-042 "What We Do" — nav label title case should fail
even in general mode).

**The line:** Nav labels are structural UI elements regardless of the
surrounding content surface. CON-02 sentence case enforcement applies to
ui_label even when audience is general.

**Patch:** Declarative `_AUDIENCE_CONTENT_TYPE_OVERRIDES` dict in filter.py.
Extensible for future content-type-aware audience overrides.

---

### P5: PRF-03 browsing_discovery relax weight

**Status:** Complete (v4.6.1). moments.py weight addition.

**Evidence:** 3 cases from Robinhood (RH-001, RH-017, RH-020). All trailing-
period headings passed human review. Periods are rhetorical cadence devices.

**Patch:** `relax` weight (not suppress) for PRF-03 in browsing_discovery.
The LLM can still flag egregious cases; suppressing would be too broad.

---

## Resolved in v4.6.0 (Wells Fargo session)

### P1-wf: compliance_disclosure moment

**Status:** Complete (v4.6.0). Shipped in moments.py, 64 tests.

### P2-wf: TRN-04 content_type_notes + filter _global fix

**Status:** Complete (v4.6.0). Surgical JSON patch + filter bug fix.

---

## Remaining

| ID | Patch | Notes |
|---|---|---|
| P6-rb | Comma splice / compounding (GRM-07?) | 1 case (RH-013). Monitor for 2+ more |
| M3 | Shared tools utils | Extract common utilities from tools/ |
| L2 | Audience toggle UI | Wire the plugin toggle for product_ui vs general |
| L3 | JS system prompt parity | Sync ui.html system prompt with Python pipeline |

---

## Corpus status after this session

| File | Cases | Domain | Source |
|---|---|---|---|
| healthcare_eval_cases.json | 67 | Healthcare | Kaiser Permanente |
| fintech_eval_cases.json | 52 | Fintech | Stripe |
| apple_eval_cases.json | 83 | E-commerce | Apple |
| wellsfargo_eval_cases.json | 50 | Fintech | Wells Fargo |
| robinhood_eval_cases.json | 44 | Fintech (consumer SaaS) | Robinhood |
| medvi_eval_cases.json | 38 | Healthcare (DTC weight loss) | MEDVi |
| **Total** | **334** | **6 domains** | **6 sources** |

## Version

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-04-01 | Initial patch queue from Wells Fargo eval (50 cases) |
| 1.1 | 2026-04-02 | P1-wf and P2-wf marked complete |
| 2.0 | 2026-04-02 | Full rewrite: Robinhood + MEDVi patches (P1-P5 complete), corpus → 334 |
