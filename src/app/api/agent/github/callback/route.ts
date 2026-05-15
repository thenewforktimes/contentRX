/**
 * GET /api/agent/github/callback — post-install handler.
 *
 * GitHub redirects here after the user finishes the App install
 * (success path) or after they click "configure" on an existing
 * install. The query carries:
 *   - installation_id    (numeric id of the new installation)
 *   - setup_action       ("install" | "update")
 *   - state              (the ContentRX team scope we passed in)
 *
 * We use this redirect for two side-effects only: deduping the
 * installation row and confirming it exists. The actual record is
 * created by the webhook (single source of truth + signature
 * verification). Most callbacks land on a DB row that the webhook
 * has already written; if not, we record a stub here that the
 * webhook will round-trip on its next delivery.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { isGithubAppConfigured, installationRequest } from "@/lib/agent/github-app";
import { logSafeError } from "@/lib/safe-error-log";
import { teamScope } from "@/lib/team-scope";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://contentrx.io";

function redirectWithError(slug: string) {
  return NextResponse.redirect(
    new URL(`/dashboard/agent?error=${slug}`, APP_URL),
  );
}

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.redirect(
      new URL("/sign-in?redirect_url=/dashboard/agent", APP_URL),
    );
  }
  if (!isGithubAppConfigured()) {
    return redirectWithError("github_app_not_configured");
  }

  const url = new URL(req.url);
  const installationIdRaw = url.searchParams.get("installation_id");
  const stateScope = url.searchParams.get("state");

  if (!installationIdRaw || !stateScope) {
    return redirectWithError("missing_callback_params");
  }
  const installationId = Number.parseInt(installationIdRaw, 10);
  if (!Number.isFinite(installationId)) {
    return redirectWithError("invalid_installation_id");
  }

  const db = getDb();

  // Confirm the calling user belongs to the team scope encoded in
  // `state`. Defense in depth: the state is server-issued, but a
  // re-check guards against installation_id reuse if the customer
  // shares the URL.
  const [user] = (await db
    .select({
      id: schema.users.id,
      teamOwnerUserId: schema.users.teamOwnerUserId,
    })
    .from(schema.users)
    .where(eq(schema.users.clerkId, userId))
    .limit(1)) as Array<{ id: string; teamOwnerUserId: string | null }>;

  if (!user) {
    return redirectWithError("account_not_provisioned");
  }
  const callerScope = teamScope({
    user: { id: user.id },
    teamOwnerUserId: user.teamOwnerUserId,
  });
  if (callerScope !== stateScope) {
    return redirectWithError("scope_mismatch");
  }

  // Resolve the installation's account login + first repo so the
  // dashboard has something to render even before the webhook lands.
  // The webhook updates the same row idempotently.
  let accountLogin = "";
  let accountType: "User" | "Organization" = "User";
  let targetRepoOwner = "";
  let targetRepoName = "";
  try {
    const request = installationRequest(installationId);
    const installResp = await request("GET /app/installations/{installation_id}", {
      installation_id: installationId,
    });
    // The `account` discriminated union covers User | Organization |
    // Enterprise. The Enterprise variant uses `slug` instead of
    // `login` and we don't expect to see it for an end-user
    // ContentRX install, but the type-narrowing keeps the build
    // honest if it ever lands.
    const account = installResp.data.account;
    if (account && "login" in account) {
      accountLogin = account.login ?? "";
      accountType =
        ("type" in account && account.type === "Organization")
          ? "Organization"
          : "User";
    }

    const reposResp = await request(
      "GET /installation/repositories",
      { per_page: 1 },
    );
    const firstRepo = reposResp.data.repositories[0];
    if (firstRepo) {
      targetRepoOwner = firstRepo.owner.login;
      targetRepoName = firstRepo.name;
    }
  } catch (err) {
    logSafeError("[/api/agent/github/callback] resolve install", err);
    // Fall through with empty fields; the webhook will populate
    // them on its next delivery.
  }

  // Upsert the installation row. The unique index on (team_id) means
  // a re-install (e.g. switching repos) updates rather than dups.
  try {
    const existing = (await db
      .select({ id: schema.agentGithubInstallations.id })
      .from(schema.agentGithubInstallations)
      .where(
        and(
          eq(schema.agentGithubInstallations.teamId, callerScope),
        ),
      )
      .limit(1)) as Array<{ id: string }>;

    if (existing[0]) {
      await db
        .update(schema.agentGithubInstallations)
        .set({
          githubInstallationId: installationId,
          // Fall back to "" (not the row's own cuid) when GitHub
          // didn't return a login — matches the insert path below.
          // Writing existing[0].id stuffed an internal ContentRX id
          // into a display-only github_account_login column: a latent
          // data-corruption / future-leak hazard.
          githubAccountLogin: accountLogin || "",
          githubAccountType: accountType,
          targetRepoOwner: targetRepoOwner || "",
          targetRepoName: targetRepoName || "",
          updatedAt: new Date(),
        })
        .where(eq(schema.agentGithubInstallations.id, existing[0].id));
    } else {
      await db.insert(schema.agentGithubInstallations).values({
        teamId: callerScope,
        githubInstallationId: installationId,
        githubAccountLogin: accountLogin || "",
        githubAccountType: accountType,
        targetRepoOwner: targetRepoOwner || "",
        targetRepoName: targetRepoName || "",
      });
    }
  } catch (err) {
    logSafeError("[/api/agent/github/callback] upsert", err);
    return redirectWithError("install_record_failed");
  }

  return NextResponse.redirect(
    new URL("/dashboard/agent?installed=1", APP_URL),
  );
}
