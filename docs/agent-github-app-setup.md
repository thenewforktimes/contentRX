# GitHub App setup — Weekly review agent

The weekly review agent's customer-facing delivery is a draft pull
request opened on a repo the customer has connected via the
ContentRX GitHub App. This doc walks through registering the App,
populating Vercel env, and verifying the wiring end-to-end.

> **STATUS — 2026-05-15: this is a live launch blocker.** A prod env
> pull (`vercel env pull --environment=production`) confirmed there
> are **zero `GITHUB_APP_*` variables in production**. The agent
> code is all merged and hardened, but `isGithubAppConfigured()` is
> false in prod, so the Connect flow has never run for a single
> customer — the differentiator cannot post a PR until steps 1–3 +
> 5 + 6 below are done. (This is also why bug-bash item "I3",
> webhook-orphan reconciliation, is moot: zero installs exist, so
> zero orphans exist. I3 stays parked until the App is live and the
> diagnostic in step 6 reports a non-zero install count.)

## What lands in code (already shipped)

- `src/lib/agent/github-app.ts` — env loader, install URL builder,
  signature verifier, installation-token-minting Octokit factory.
- `src/lib/agent/open-pr.ts` — branch + draft-PR creation.
- `/api/agent/github/install` — Connect-flow initiation.
- `/api/agent/github/callback` — post-install handler.
- `/api/agent/github/webhook` — installation event receiver.
- `/dashboard/agent` — Connect button + connection status.
- `/api/cron/agent-run` — opens a draft PR after persisting each run
  for teams with a connected installation.

The code is gated by `isGithubAppConfigured()`, so until the env vars
are set the surface renders "registration in progress" and no GitHub
calls go out.

## Setup — Robert's checklist

### 1. Register the App

Go to <https://github.com/settings/apps/new>. Fill in:

| Field | Value |
|---|---|
| GitHub App name | `ContentRX Agent` (or similar; the slug derives from this) |
| Homepage URL | `https://contentrx.io/dashboard/agent` |
| Callback URL | `https://contentrx.io/api/agent/github/callback` |
| Setup URL (post-install redirect) | `https://contentrx.io/api/agent/github/callback` |
| Webhook URL | `https://contentrx.io/api/agent/github/webhook` |
| Webhook secret | Generate a strong random string, save it for step 3 |

**Repository permissions:**

| Permission | Access | Why |
|---|---|---|
| Pull requests | Read & write | Open the draft PR |
| Contents | Read & write | Create the marker branch + commit the digest file |
| Metadata | Read | Required by GitHub for any App; can't be turned off |

**Account permissions:** none.

**Subscribe to events:**

- `Installation` — fires when a customer installs/uninstalls the App
- `Installation repositories` — fires when a customer adds/removes repos from an existing install

**Where can this App be installed?** Any account.

Click **Create GitHub App**.

### 2. Generate the App's private key

On the App's settings page, scroll to **Private keys** → **Generate
a private key**. GitHub downloads a `.pem` file. Save it somewhere
you can find again (Robert's password manager is the right place).

The key needs to land in Vercel env in one of two formats:

- **Recommended:** base64-encoded — `cat the-key.pem | base64 |
  pbcopy`. Paste-safe in Vercel env's single-line input.
- **Alternative:** literal PEM with escaped newlines — `awk 1 ORS='\\n'
  the-key.pem`. Works but more error-prone.

The env loader in `src/lib/agent/github-app.ts` handles both.

### 3. Set Vercel env vars

In the Vercel dashboard for the `content-rx` project, **Settings →
Environment Variables**, add (Production scope):

```
GITHUB_APP_ID                = <App ID from the settings page>
GITHUB_APP_CLIENT_ID         = <Client ID from the settings page>
GITHUB_APP_CLIENT_SECRET     = <Client secret — generated separately>
GITHUB_APP_PRIVATE_KEY       = <base64 of the .pem from step 2>
GITHUB_APP_WEBHOOK_SECRET    = <the random string from step 1>
GITHUB_APP_SLUG              = <App name slug, e.g. "contentrx-agent">
```

The Client secret has its own **Generate a new client secret** button
on the App's settings page; generate one + copy the value before
saving (it's shown once).

### 4. DB table — already done, skip

**Historical — no action needed for prod launch.** The
`agent_github_installations` table shipped with the original agent
wiring (#441, "feat(agent): GitHub App wiring") and has been in prod
since. The steps below are kept only for bootstrapping a brand-new
database (e.g. a fresh staging env); for the production launch you
are doing now, the table already exists — go straight to step 5.

<details>
<summary>Fresh-database bootstrap only</summary>

`node scripts/apply-agent-github-installations-migration.mjs`
(idempotent) or `npm run db:push`. The "schema-drift footgun"
below also only applied to the original #441 merge window and is
no longer reachable.

</details>

### 5. Trigger a redeploy

After saving env vars, run `vercel --prod` from a clean working tree
or push an empty commit to main. The deploy picks up the new env;
the dashboard's `isGithubAppConfigured()` flips to true.

### 6. Verify end-to-end

**Prerequisite — the test account must be on the Team plan.** Since
#569 the Connect flow is gated on `plan === "team"`: a free/pro
account sees an "A Team plan feature" upgrade card, NOT the Connect
button, and `/api/agent/github/install` redirects non-team users
away with `?error=team_plan_required`. (Solo-on-Team counts as
Team — you don't need a multi-person org.) Use a Team-plan test
account, or temporarily set one up, or you'll think it's broken.

1. Sign in (Team-plan account) to
   <https://contentrx.io/dashboard/agent>. The "Connect GitHub"
   button should be live (not "registration in progress", and not
   the "A Team plan feature" upgrade card).
2. Click **Connect GitHub →**. GitHub redirects to the install page.
3. Pick a test repo (a private one is fine) **and make sure you
   grant the App access to at least one repository**. Click
   **Install**.
4. GitHub redirects back to `/dashboard/agent?installed=1`. Expected
   states (since #570):
   - **Repo selected →** green "Connected." + repo coordinates.
   - **No repo granted →** a caution "Connected to GitHub, but no
     repository is selected" + a "Reconfigure connection" CTA. This
     is correct behavior, not a bug — re-run step 2–3 and grant a
     repo. The cron will surface this team as `no_repo_connected`
     on `/admin/agent-runs` rather than silently doing nothing.
5. Hit `POST /api/cron/agent-run` with the cron secret to fire a
   manual run:

   ```bash
   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
     https://contentrx.io/api/cron/agent-run
   ```

   Response includes `prsOpened: 1` if the run produced a draft PR.
   (Since #574 a same-week re-fire is idempotent per team — a second
   call returns the run as skipped rather than double-posting.)
6. Check the test repo for a new branch named
   `contentrx-agent/run-<timestamp>` and a draft PR titled
   `ContentRX weekly review · <timestamp>`.
7. **Health check (since #575).** With prod env loaded, run the
   reconciliation diagnostic:

   ```bash
   npx dotenv-cli -e .env.prod.local -- \
     tsx scripts/diagnose-agent-installs.ts
   ```

   After a successful test install it should report
   `db_only: 0`, `db_no_repo: 0`, and `github_only: 0` (your test
   install now has a matching row). A non-zero `github_only` here —
   once the App is genuinely live — is the I3 signal: that's when
   webhook-orphan reconciliation becomes worth designing. Until the
   App is live this diagnostic errors on the missing
   `GITHUB_APP_*`, which is itself the launch-blocker check.

### Schema-drift footgun (historical — resolved at #441 merge)

> Kept for the archive. This only applied to the original #441
> merge window, when `agent_github_installations` could exist in
> prod but not yet in `main`'s `schema.ts`. The table and schema
> have been in sync since #441; there is no drop-table risk doing
> the prod launch today. Ignore for the current task.

Original note: if you ran `npm run db:push` from `main` BEFORE the
#441 PR merged, drizzle-kit would see `agent_github_installations`
in prod but NOT in `main`'s `schema.ts`, and propose to drop the
table. Mitigation at the time: don't apply the migration until
after merge.

## Tier B follow-ups (not in this PR)

Things V1 deliberately punts:

- **Repo selection UI.** V1 takes the first repo the App was
  installed on. V2 lets the team pick.
- **Branch selection UI.** V1 hardcodes `main`. V2 reads default
  branch dynamically + lets the team override.
- **Disconnect button.** V1 relies on the customer uninstalling the
  App from GitHub directly; the webhook then drops the row.
- **Draft-fix PRs (Agent V2).** Per the roadmap: "Re-evaluate after
  V1 has run for 30+ days on at least 5 paying Team-tier customers,
  with override-volume data on the V1 recommendations."
