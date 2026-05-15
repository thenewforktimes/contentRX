/**
 * /dashboard/agent — the weekly review agent install + preview surface.
 *
 * Phase G3 of the 2026-05-09 roadmap, plus the GitHub-App follow-up
 * that wires the Connect flow. Three things on this page:
 *
 *   1. The locked copy describing what the agent does, where it
 *      reads from, and the zero-checks-per-run cost. The roadmap
 *      pins this wording verbatim; the same string appears in the
 *      PR-comment footer (src/lib/agent/render-digest.ts) and (when
 *      the GitHub App is live) the install confirmation toast. The
 *      page test pins the page version against the footer constant.
 *
 *   2. A "Connect GitHub" button that initiates the standard GitHub
 *      App OAuth flow. When the App isn't yet configured (env vars
 *      unset), the button is replaced with a "registration in
 *      progress" callout. When the team is already connected, the
 *      same slot shows the connected repo + the most recent draft
 *      PR.
 *
 *   3. The "Run preview now" button (interactive client island).
 *      Posts to /api/agent/preview and renders the digest the agent
 *      would post if the cron ran right now. Zero checks consumed.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { Card } from "@/components/ui/card";
import { buttonStyles } from "@/components/ui/button";
import { isGithubAppConfigured } from "@/lib/agent/github-app";
import { teamScope } from "@/lib/team-scope";
import { AgentPreviewIsland } from "./agent-preview-island";

export const metadata = {
  title: "Weekly review agent. ContentRX",
};

// Locked copy the roadmap pins verbatim. Lives once here and is
// repeated in the PR-comment footer (render-digest.ts:ZERO_CHECKS_FOOTER).
// If a future edit changes one, change all three (page copy, modal
// copy, PR footer).
const PAGE_LOCKED_COPY =
  "Weekly review agent. A draft pull request every Monday with the patterns ContentRX has flagged across your repo. Read-only. The agent never edits your strings. Cost: 0 checks per run. The agent reads flags your other surfaces have already produced (Figma plugin, GitHub Action, MCP, LSP, CLI, paste mode) and renders them as a weekly digest. Your monthly check limit is unaffected.";

type Installation = {
  githubAccountLogin: string;
  targetRepoOwner: string;
  targetRepoName: string;
  targetBranch: string;
  lastPrNumber: number | null;
  lastPrUrl: string | null;
  lastPrAt: Date | null;
};

async function loadInstallation(scopeId: string): Promise<Installation | null> {
  const db = getDb();
  const rows = (await db
    .select({
      githubAccountLogin: schema.agentGithubInstallations.githubAccountLogin,
      targetRepoOwner: schema.agentGithubInstallations.targetRepoOwner,
      targetRepoName: schema.agentGithubInstallations.targetRepoName,
      targetBranch: schema.agentGithubInstallations.targetBranch,
      lastPrNumber: schema.agentGithubInstallations.lastPrNumber,
      lastPrUrl: schema.agentGithubInstallations.lastPrUrl,
      lastPrAt: schema.agentGithubInstallations.lastPrAt,
    })
    .from(schema.agentGithubInstallations)
    .where(eq(schema.agentGithubInstallations.teamId, scopeId))
    .limit(1)) as Array<Installation>;
  return rows[0] ?? null;
}

export default async function AgentPage({
  searchParams,
}: {
  searchParams: Promise<{ installed?: string; error?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in?redirect_url=/dashboard/agent");
  }

  const params = await searchParams;
  const githubAppLive = isGithubAppConfigured();

  const db = getDb();
  const userRows = (await db
    .select({
      id: schema.users.id,
      teamOwnerUserId: schema.users.teamOwnerUserId,
      plan: schema.users.plan,
    })
    .from(schema.users)
    .where(eq(schema.users.clerkId, userId))
    .limit(1)) as Array<{
    id: string;
    teamOwnerUserId: string | null;
    plan: string;
  }>;

  // The agent is a Team-plan feature (the cron only runs plan="team"
  // owners). Gate the connect UI so a non-team user never starts the
  // GitHub OAuth flow into a dead-end; the install route enforces the
  // same server-side.
  const isTeam = userRows[0]?.plan === "team";

  const scopeId = userRows[0]
    ? teamScope({
        user: { id: userRows[0].id },
        teamOwnerUserId: userRows[0].teamOwnerUserId,
      })
    : null;

  const installation = scopeId ? await loadInstallation(scopeId) : null;

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-quiet">
          Weekly review agent
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-strong">
          A draft pull request every Monday.
        </h1>
        <p className="mt-3 text-sm text-default">{PAGE_LOCKED_COPY}</p>
      </header>

      {params.installed && installation && (
        <div
          role="status"
          className="rounded-md border border-accent-affirm-border bg-accent-affirm-soft p-4 text-sm text-accent-affirm-text"
        >
          <p className="font-semibold">Connected.</p>
          <p className="mt-1">
            ContentRX will open a draft pull request on{" "}
            <span className="font-mono">
              {installation.targetRepoOwner}/{installation.targetRepoName}
            </span>{" "}
            every Monday at 13:00 UTC.
          </p>
        </div>
      )}

      {params.error && (
        <div
          role="alert"
          className="rounded-md border border-accent-caution-border bg-accent-caution-soft p-4 text-sm text-accent-caution-text"
        >
          <p>
            {githubAppErrorMessage(params.error, githubAppLive)}
          </p>
        </div>
      )}

      <ConnectCard
        githubAppLive={githubAppLive}
        installation={installation}
        isTeam={isTeam}
      />

      <AgentPreviewIsland />
    </div>
  );
}

function ConnectCard({
  githubAppLive,
  installation,
  isTeam,
}: {
  githubAppLive: boolean;
  installation: Installation | null;
  isTeam: boolean;
}) {
  if (!isTeam) {
    return (
      <Card variant="emphasis" padding="lg" className="space-y-3">
        <h2 className="text-lg font-semibold text-strong">
          A Team plan feature
        </h2>
        <p className="text-sm text-default">
          The weekly review agent opens a draft pull request on your
          repo every Monday, at a cost of zero checks. It ships with
          the Team plan.
        </p>
        <p className="text-sm text-quiet">
          You can still preview the digest below without a Team plan
          or a connected repo. It runs the same grouping your team
          would receive, posting nothing to GitHub.
        </p>
        <div className="pt-2">
          <Link
            href="/pricing"
            className={buttonStyles({ variant: "primary", size: "sm" })}
          >
            Upgrade to Team →
          </Link>
        </div>
      </Card>
    );
  }

  if (!githubAppLive) {
    return (
      <Card variant="emphasis" padding="lg" className="space-y-3">
        <h2 className="text-lg font-semibold text-strong">
          Connect your repo
        </h2>
        <p className="text-sm text-default">
          The agent posts the weekly digest as a draft pull request on
          a repo you connect via the ContentRX GitHub App. Same OAuth
          shape your team uses for Dependabot or Renovate.
        </p>
        <p className="text-sm text-quiet">
          GitHub App registration is in progress; the &lsquo;Connect
          GitHub&rsquo; button activates once the app is live. In the
          meantime, the &lsquo;Run preview now&rsquo; button below
          renders the same digest your team would receive on Monday,
          without posting anything to GitHub.
        </p>
      </Card>
    );
  }

  if (installation) {
    return (
      <Card variant="emphasis" padding="lg" className="space-y-3">
        <h2 className="text-lg font-semibold text-strong">
          Connected repo
        </h2>
        <p className="text-sm text-default">
          The agent opens a draft pull request on{" "}
          <span className="font-mono text-strong">
            {installation.targetRepoOwner}/{installation.targetRepoName}
          </span>{" "}
          every Monday at 13:00 UTC, against{" "}
          <span className="font-mono text-strong">
            {installation.targetBranch}
          </span>
          .
        </p>
        {installation.lastPrUrl ? (
          <p className="text-sm text-default">
            Most recent draft:{" "}
            <a
              href={installation.lastPrUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-strong"
            >
              #{installation.lastPrNumber}
            </a>
            {installation.lastPrAt && (
              <>
                {" "}
                <span className="text-quiet">
                  ({installation.lastPrAt.toISOString().slice(0, 10)})
                </span>
              </>
            )}
            .
          </p>
        ) : (
          <p className="text-sm text-quiet">
            No draft pull request yet. The next scheduled run is the
            upcoming Monday at 13:00 UTC.
          </p>
        )}
        <div className="pt-2">
          <Link
            href="/api/agent/github/install"
            className={buttonStyles({ variant: "secondary", size: "sm" })}
          >
            Reconfigure connection
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card variant="emphasis" padding="lg" className="space-y-3">
      <h2 className="text-lg font-semibold text-strong">
        Connect your repo
      </h2>
      <p className="text-sm text-default">
        The agent posts the weekly digest as a draft pull request on a
        repo you connect via the ContentRX GitHub App. Same OAuth
        shape your team uses for Dependabot or Renovate.
      </p>
      <p className="text-sm text-quiet">
        Read-only. The agent never edits your checks. The PR is
        always opened as a draft so it sits dormant until you decide
        to engage with it.
      </p>
      <div className="pt-2">
        <Link
          href="/api/agent/github/install"
          className={buttonStyles({ variant: "primary" })}
        >
          Connect GitHub →
        </Link>
      </div>
    </Card>
  );
}

function githubAppErrorMessage(slug: string, githubAppLive: boolean): string {
  if (slug === "github_app_not_configured" || !githubAppLive) {
    return "GitHub App registration is in progress. The Connect button activates once the app is live.";
  }
  if (slug === "scope_mismatch") {
    return "The install link belonged to a different team. Try the Connect button again.";
  }
  if (slug === "missing_callback_params") {
    return "The GitHub callback didn't include the install id. Try the Connect button again.";
  }
  if (slug === "install_record_failed") {
    return "Couldn't record the installation. Try again. If it keeps happening, email hello@contentrx.io.";
  }
  if (slug === "account_not_provisioned") {
    return "We're finishing setting up your account. Refresh in a moment.";
  }
  if (slug === "team_plan_required") {
    return "The weekly review agent is a Team plan feature. Upgrade to connect a repo.";
  }
  return "Couldn't complete the connection. Try the Connect button again.";
}
