# Substrate repo setup — wiring the change-trigger

ContentRX's private substrate (`thenewforktimes/contentRX-substrate`) is
where Robert hand-maintains the editorial library. Public CI is the
testing surface — every public-repo PR pulls the latest substrate and
runs it through the engine. But substrate-only changes don't trigger
a public-repo PR, so they could sit in the substrate repo for days
before someone discovers the next public PR is failing because of a
substrate change made on Monday.

This doc wires the substrate repo so every push fires a
`repository_dispatch` event that triggers the public repo's
`substrate-changed.yml` workflow (which validates structure + runs
the substrate-aware engine tests + the parity gates).

## One-time setup (5 minutes)

### Step 1: Create a fine-grained PAT

1. Go to <https://github.com/settings/personal-access-tokens/new>.
2. **Token name:** `substrate → contentRX dispatch`.
3. **Resource owner:** `thenewforktimes` (or your personal account if
   that's where the repos live — pick whichever owns both
   `contentRX` and `contentRX-substrate`).
4. **Expiration:** 90 days, or "no expiration" if you want to skip
   the rotation cadence. (The dispatch workflow can't run with an
   expired token, so a long expiry is friendlier.)
5. **Repository access:** "Only select repositories" → pick
   `contentRX` (the public repo — that's where the workflow lives
   that needs to be triggered).
6. **Permissions:** under "Repository permissions", scroll to
   **Contents: Read and write** (needed so the dispatch reaches the
   workflow). No other permissions needed.
7. Click "Generate token" and **copy the value** — GitHub only shows
   it once.

### Step 2: Add the PAT as a secret on the substrate repo

1. Go to <https://github.com/thenewforktimes/contentRX-substrate/settings/secrets/actions>.
2. Click "New repository secret".
3. **Name:** `PUBLIC_REPO_DISPATCH_TOKEN` (exact match — the
   workflow file below references this name).
4. **Value:** paste the PAT from step 1.
5. Save.

### Step 3: Drop the workflow file into the substrate repo

In your local clone of `contentRX-substrate`, create
`.github/workflows/notify-public-repo.yml` with this exact content:

```yaml
name: Notify public repo of substrate change

# Fires a repository_dispatch event at the public ContentRX repo
# every time anything lands on main here. The public repo's
# substrate-changed.yml workflow listens for this event type
# (`substrate-changed`) and runs the structural validator + the
# substrate-aware engine tests + parity gates.
#
# Setup: see docs/substrate-repo-setup.md in the public repo for the
# fine-grained PAT and secret-name details.

on:
  push:
    branches: [main]

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Dispatch to contentRX
        env:
          GH_TOKEN: ${{ secrets.PUBLIC_REPO_DISPATCH_TOKEN }}
        run: |
          gh api \
            --method POST \
            -H "Accept: application/vnd.github+json" \
            /repos/thenewforktimes/contentRX/dispatches \
            -f event_type=substrate-changed \
            -f client_payload[sha]="${{ github.sha }}" \
            -f client_payload[ref]="${{ github.ref }}"
```

Commit + push to the substrate repo's main branch. The first push
will itself trigger the dispatch — check the Actions tab on the
public repo within a few seconds to confirm the
`Substrate-change verification` workflow ran.

## What you get

- **Push to substrate → public CI runs within ~30 seconds.** Any
  JSON parse error, duplicate ID, missing required field, or
  total_standards mismatch fails the workflow and emails you.
- **Daily safety net.** Even if the PAT expires or the dispatch
  somehow doesn't fire, the cron at 11:00 UTC catches drift within
  24 hours.
- **Manual trigger.** While debugging a substrate change locally,
  hit "Run workflow" on the public repo's Actions tab to run the
  full check against the latest pushed substrate.

## What the public-side workflow checks

(See `.github/workflows/substrate-changed.yml` in the public repo
for the full job spec.)

1. **Structural validation** via `scripts/validate-substrate.py`:
   JSON parses, required top-level keys exist, unique standard IDs,
   unique content_type IDs, unique moment IDs, every standard has
   `id` / `rule` / `correct` / `incorrect`, `total_standards`
   matches actual count.
2. **Cross-file references as warnings:** if `moments_taxonomy.json`
   or `ui_specific_standards.json` references a standard_id that's
   not in `standards_library.json`, it warns but doesn't fail (the
   engine tolerates orphans).
3. **The 8 substrate-aware pytest files** — same files the public
   PR CI runs against substrate.
4. **The 5 JS/Python parity gates** — re-run here so a substrate-side
   add (new content_type, new moment) gets caught immediately
   rather than waiting for the next public PR.

## What happens when it fails

You get a failure email from GitHub Actions with a link to the
workflow log. The log names the specific error and points at the
file + line. The fix is a follow-up commit to the substrate repo
correcting or reverting the change.

If the validator is too strict for a legitimate case, edit
`scripts/validate-substrate.py` in the public repo — the validation
logic lives there so updates don't require a substrate-repo touch.

## Rotation note

The PAT expires per the timeline you set in step 1. When it
expires, the dispatch workflow on the substrate repo starts failing
silently (the public-repo run never gets pinged). The daily cron in
the public repo catches drift in the meantime, but the immediate
feedback loop is gone until you re-run steps 1–2 with a fresh PAT.
Calendar a reminder for ~5 days before expiry if you didn't pick
"no expiration."
