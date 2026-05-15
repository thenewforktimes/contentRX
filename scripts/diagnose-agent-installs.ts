/**
 * Read-only diagnostic: how bad is the agent-install orphan problem?
 *
 * Deferred bug-bash item "I3" proposes a webhook-stub → callback-adopt
 * handshake for GitHub App installs that never got linked to a
 * ContentRX team (user closed the tab before the OAuth callback
 * resolved). Before building that, we need ONE number: how many
 * orphans actually exist. This script answers that and two related
 * health signals. It mutates nothing.
 *
 * Run against PRODUCTION env (prod DATABASE_URL + prod GITHUB_APP_*):
 *
 *   npm run diagnose:agent-installs
 *
 * (Wrapped with `dotenv -e .env.local`; point that file — or the
 * shell env — at prod when you run it. App-level GitHub auth is a
 * read-only `GET /app/installations`; the DB side is a Drizzle
 * select. Nothing is written either side.)
 *
 * Reports three classes:
 *   1. github_only  — GitHub says installed, no agent_github_installations
 *                      row. THIS is the I3 orphan. Its size decides
 *                      whether I3 is worth building at all.
 *   2. db_only       — a row whose githubInstallationId is no longer
 *                      installed on GitHub (a missed installation.deleted
 *                      webhook). Bonus signal.
 *   3. db_no_repo    — a row with an empty target repo (the C6 / PR-F
 *                      "connected but unconfigured" state). Bonus signal.
 */

import { createAppAuth } from "@octokit/auth-app";
import { request as octokitRequest } from "@octokit/request";
import { getDb, schema } from "@/db";
import { readGithubAppConfig } from "@/lib/agent/github-app";

type GhInstallation = { id: number; account: { login: string } | null };

async function listAllGithubInstallations(): Promise<GhInstallation[]> {
  const config = readGithubAppConfig();
  if (!config) {
    throw new Error(
      "GITHUB_APP_* env vars not set — point the env at prod before running.",
    );
  }
  // App-level (JWT) auth, NOT installation-scoped: GET /app/installations
  // is an app endpoint. createAppAuth without an installationId makes
  // the hook mint an app JWT for these routes.
  const auth = createAppAuth({
    appId: config.appId,
    privateKey: config.privateKey,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });
  const req = octokitRequest.defaults({ request: { hook: auth.hook } });

  const all: GhInstallation[] = [];
  for (let page = 1; ; page += 1) {
    const res = await req("GET /app/installations", {
      per_page: 100,
      page,
    });
    const batch = res.data as GhInstallation[];
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

async function main() {
  const [ghInstalls, dbRows] = await Promise.all([
    listAllGithubInstallations(),
    getDb()
      .select({
        githubInstallationId: schema.agentGithubInstallations.githubInstallationId,
        teamId: schema.agentGithubInstallations.teamId,
        targetRepoName: schema.agentGithubInstallations.targetRepoName,
      })
      .from(schema.agentGithubInstallations),
  ]);

  const dbByInstallId = new Map(
    dbRows.map((r) => [r.githubInstallationId, r]),
  );
  const ghIds = new Set(ghInstalls.map((i) => i.id));

  const githubOnly = ghInstalls.filter((i) => !dbByInstallId.has(i.id));
  const dbOnly = dbRows.filter((r) => !ghIds.has(r.githubInstallationId));
  const dbNoRepo = dbRows.filter(
    (r) => !r.targetRepoName || r.targetRepoName.length === 0,
  );

  const line = "-".repeat(60);
  console.log(line);
  console.log("Agent-install reconciliation diagnostic");
  console.log(line);
  console.log(`GitHub installations (total):       ${ghInstalls.length}`);
  console.log(`agent_github_installations rows:    ${dbRows.length}`);
  console.log(line);
  console.log(
    `[1] github_only  (I3 orphans):      ${githubOnly.length}`,
  );
  for (const i of githubOnly) {
    console.log(`      install ${i.id}  account=${i.account?.login ?? "?"}`);
  }
  console.log(
    `[2] db_only      (stale rows):      ${dbOnly.length}`,
  );
  for (const r of dbOnly) {
    console.log(
      `      install ${r.githubInstallationId}  teamId=${r.teamId}`,
    );
  }
  console.log(
    `[3] db_no_repo   (unconfigured):    ${dbNoRepo.length}`,
  );
  console.log(line);
  console.log(
    githubOnly.length === 0
      ? "Verdict: zero I3 orphans. The webhook-reconciliation handshake is cost with no benefit — a one-line webhook log + manual runbook suffices."
      : `Verdict: ${githubOnly.length} I3 orphan(s). Weigh the handshake cost against this number and the never-completes UX before building.`,
  );
  console.log(line);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("diagnose-agent-installs failed:", err);
    process.exit(1);
  });
