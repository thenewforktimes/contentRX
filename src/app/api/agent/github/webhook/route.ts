/**
 * POST /api/agent/github/webhook — GitHub App webhook receiver.
 *
 * GitHub posts here when an installation is created, updated, or
 * deleted. We verify the signature with our webhook secret, then
 * upsert the installation row (or delete on uninstall).
 *
 * Events handled:
 *   - installation.created       — new install, write the row
 *   - installation.deleted       — user uninstalled, drop the row
 *   - installation_repositories  — repos added/removed; we re-pick
 *                                  the first repo so the cron has a
 *                                  current target.
 *
 * Other events are acknowledged with 200 + ignored.
 *
 * Security:
 *   - Signature verification is mandatory; missing/invalid signatures
 *     return 401 without touching the DB.
 *   - We do NOT trust the `state` parameter here (webhooks don't
 *     carry one); the row is keyed by github_installation_id, and
 *     the team_id is whatever the existing row has. New installs
 *     where the team_id is unknown are upserted with the GitHub
 *     account_login as a placeholder; the post-install callback
 *     replaces it with the actual ContentRX team scope.
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import {
  isGithubAppConfigured,
  verifyWebhookSignature,
} from "@/lib/agent/github-app";
import { logSafeError } from "@/lib/safe-error-log";

type InstallationPayload = {
  action?: string;
  installation?: {
    id?: number;
    account?: { login?: string; type?: string };
  };
  repositories?: Array<{ owner?: { login?: string }; name?: string }>;
};

export async function POST(req: Request) {
  // Internal-API responses on a server-to-server webhook surface.
  // GitHub is the only caller that reads these; no human ever sees
  // them. We use snake_case error codes (rather than English
  // sentences) for the same reason every well-behaved webhook does:
  // the consumer logs the code, the developer reads the code, no
  // one expects "Try again. If it keeps happening, email
  // hello@contentrx.io." in a webhook delivery log.
  if (!isGithubAppConfigured()) {
    return NextResponse.json(
      { code: "github_app_not_configured" },
      { status: 503 },
    );
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json(
      { code: "signature_verification_failed" },
      { status: 401 },
    );
  }

  let payload: InstallationPayload;
  try {
    payload = JSON.parse(rawBody) as InstallationPayload;
  } catch {
    return NextResponse.json(
      { code: "malformed_request_body" },
      { status: 400 },
    );
  }

  const event = req.headers.get("x-github-event") ?? "";
  const action = payload.action ?? "";
  const installationId = payload.installation?.id;
  if (!installationId) {
    return NextResponse.json({ ok: true, ignored: "no_installation" });
  }

  const db = getDb();

  try {
    if (event === "installation" && action === "deleted") {
      await db
        .delete(schema.agentGithubInstallations)
        .where(
          eq(schema.agentGithubInstallations.githubInstallationId, installationId),
        );
      return NextResponse.json({ ok: true, action: "deleted" });
    }

    if (
      (event === "installation" && (action === "created" || action === "new_permissions_accepted")) ||
      event === "installation_repositories"
    ) {
      const accountLogin = payload.installation?.account?.login ?? "";
      const accountType =
        payload.installation?.account?.type === "Organization"
          ? "Organization"
          : "User";
      const firstRepo = payload.repositories?.[0];
      const targetRepoOwner =
        firstRepo?.owner?.login ?? accountLogin ?? "";
      const targetRepoName = firstRepo?.name ?? "";

      const existing = (await db
        .select({
          id: schema.agentGithubInstallations.id,
          teamId: schema.agentGithubInstallations.teamId,
        })
        .from(schema.agentGithubInstallations)
        .where(
          and(
            eq(
              schema.agentGithubInstallations.githubInstallationId,
              installationId,
            ),
          ),
        )
        .limit(1)) as Array<{ id: string; teamId: string }>;

      if (existing[0]) {
        await db
          .update(schema.agentGithubInstallations)
          .set({
            githubAccountLogin: accountLogin,
            githubAccountType: accountType,
            targetRepoOwner: targetRepoOwner,
            targetRepoName: targetRepoName,
            updatedAt: new Date(),
          })
          .where(eq(schema.agentGithubInstallations.id, existing[0].id));
      }
      // Else: webhook arrived BEFORE the callback ran. We don't
      // create the row here because we don't know the team_id —
      // the callback owns row creation. The customer will be back
      // through the callback within seconds.
      return NextResponse.json({
        ok: true,
        action,
        installationId,
        knownTeam: Boolean(existing[0]),
      });
    }

    return NextResponse.json({ ok: true, ignored: event });
  } catch (err) {
    logSafeError("[/api/agent/github/webhook]", err);
    return NextResponse.json(
      { code: "webhook_handler_error" },
      { status: 500 },
    );
  }
}
