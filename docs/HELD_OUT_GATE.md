# Held-out eval gate

Human-eval build plan Session 6. A blocking CI gate that runs the
held-out manifest against the current engine and fails any PR whose
verdicts drift without explicit approval. Plus an "approval ceremony"
enforced via commit-message convention.

## What the gate checks

The gate runs on every PR touching:

- `src/content_checker/**` (the engine)
- `api/evaluate.py` (the Vercel Python function)
- `evals/held_out/manifest.json` (the held-out list itself)
- `evals/novel_cases.json` (the sibling library-regression corpus)
- `tools/select_held_out.py` / `tools/run_held_out.py`
- `.github/workflows/held_out.yml`

Two jobs fire:

1. **`held-out-update` convention** — fast, free, no corpus needed.
   Walks every commit in the PR. If a commit edits
   `evals/held_out/manifest.json` or anything under `evals/industry/`,
   it must prefix its subject line with `held-out-update:` and
   include a short reason. Catches silent verdict rewrites.
2. **Held-out gate** — executes the pipeline on the 100 manifest
   cases and fails on any disagreement. Requires the private
   industry corpus to be available in CI (see below).

## The `held-out-update:` commit convention

Any commit that modifies held-out data must prefix its subject line
with `held-out-update:` and include a short reason on the same line.

**Passes:**
```
held-out-update: revise apple-042 after second review; prompt wording shifted judgment
held-out-update: split CLR-01 novel counterpart after refinement-log ref#17
```

**Fails:**
```
fix: update manifest                  ← no prefix, no reason
chore(eval): bump manifest            ← wrong prefix
held-out-update:                      ← prefix but no reason
```

Good reasons answer the "why":
- What case changed, and why
- Which refinement-log entry motivated it (if any)
- What review process led to the new verdict

Bad reasons (usually indicate the change isn't actually an approved
update): "sync manifest", "regenerated", "small tweak."

### How to write the commit

1. Make the manifest change locally.
2. Stage it.
3. Commit with a prefixed subject: `git commit -m "held-out-update: <reason>"`
4. Push.

The convention check runs on the PR and either passes (prefix found on
every held-out-touching commit) or fails with a diagnostic pointing at
the offending commit.

### What the convention does NOT cover

- **Adding cases** to the corpus — `evals/industry/*.json` lives
  outside git (gitignored private data). Additions don't show up in
  a PR diff, so the gate doesn't see them. The convention still
  applies conceptually; the gate enforces it only on committed changes.
- **Bumping a standard's `version` field** in `standards_library.json` —
  that's a per-standard versioning event (Session 1), not a held-out
  verdict change. No prefix required.
- **Tightening the engine prompts** — those land under
  `src/content_checker/`. The gate job runs on those PRs but the
  convention job does not fire unless the manifest itself changes.

## Running the gate locally

Every engine change should be tested locally before push. The
convention job is near-instant; the gate job takes a few minutes and
real API calls.

```sh
# 1. Convention — scans HEAD vs origin/main
python3 scripts/check_held_out_convention.py

# 2. Full gate — runs the 100-case pipeline and computes kappa
python3 tools/run_held_out.py

# Optionally emit a JSON report for later comparison:
python3 tools/run_held_out.py --report /tmp/held_out_report.json
```

The runner exits:
- `0` — full agreement
- `2` — at least one case disagreed (same signal CI uses to fail)
- `3` — corpus files not found (silent pass is not a supported state)

## Configuring CI to run the gate

Today the held-out gate is wired but **not enabled** — the workflow
runs on relevant PRs, detects the missing corpus secret, emits a
notice, and exits cleanly. To flip it on:

1. **Pack the private corpus.** From a checkout with
   `evals/industry/` populated:
   ```sh
   tar -czf industry.tar.gz -C evals industry
   ```
   The archive should contain a single top-level directory named
   `industry/` so the workflow's `--strip-components=1` lands the
   files in `evals/industry/`.
2. **Host it somewhere private.** Options: a time-limited S3
   presigned URL, a private GitHub release asset, or any URL the
   Actions runner can `curl`. The URL must return the tarball
   unauthenticated.
3. **Add the secret.** Repository → Settings → Secrets and variables
   → Actions → New repository secret:
   - `HELD_OUT_CORPUS_TARBALL_URL` = the URL above
   - `ANTHROPIC_API_KEY` = a key authorized for engine-pipeline calls
4. **Verify.** Open a test PR that touches `src/content_checker/`.
   The `held-out gate` job should now run the gate instead of
   skipping.

### Cost note

Running the gate calls the Anthropic API for each of 100 cases twice
(scan + validate). Sonnet at today's prices is ~$0.50–$1 per gate run.
The workflow's `paths:` filter ensures it only fires on engine /
standards / held-out PRs, not every commit.

### Rotating the corpus

When annotation adds cases or retires old ones:

1. Re-run `python3 tools/select_held_out.py` on the updated corpus.
   The selection is deterministic, so existing cases stay stable —
   only new/retired cases churn.
2. Re-pack the tarball and re-upload to the URL (or rotate the URL +
   update the secret).
3. Commit the updated `evals/held_out/manifest.json` with a
   `held-out-update:` prefix explaining the corpus refresh.

## Approval ceremony when a regression is real

When a PR lands that legitimately needs to move a held-out verdict
(e.g., a refined standard's judgment shifts on a specific case):

1. Re-run the gate locally to see the disagreement.
2. Decide: is the engine's new verdict correct? (If not, fix the
   engine instead.)
3. Update `evals/held_out/manifest.json` to match the new verdict.
   The source verdict in `evals/industry/<file>.json` may also need
   updating if the human-verdict drift is intentional.
4. Commit with `held-out-update: <reason>`.
5. Push. The convention job passes (prefix present). The gate job
   re-runs and passes (verdicts now match).

There is **no environment-variable bypass** on the gate. The only
path past a failing gate is a real `held-out-update:` commit.

## Relationship to other gates

| Gate | Tests | Threshold | Source |
|---|---|---|---|
| Library regression | Each rule fires on synthetic adversarial inputs | ≥98% | `evals/novel_cases.json` (committed) |
| **Held-out (this)** | **Engine vs human verdicts on production-like data** | **κ-based (Session 10)** | **`evals/industry/` (gitignored)** |
| Vitest | TypeScript lib functions | 100% pass | `src/**/*.test.ts` |
| Pytest | Python engine logic | 100% pass | `tests/` |

Each gate catches a different class of regression. Never collapse them
into one metric — the plan's standing note "measured metrics and
design targets are distinct" applies here too.
