/**
 * /dashboard/agent — the weekly review agent install + preview surface.
 *
 * Phase G3 of the 2026-05-09 roadmap. Three things on this page:
 *
 *   1. The locked copy describing what the agent does, where it
 *      reads from, and the zero-checks-per-run cost. The roadmap
 *      pins this wording verbatim; the same string appears in the
 *      PR-comment footer (src/lib/agent/render-digest.ts) and will
 *      appear in the install confirmation modal when the GitHub App
 *      is registered. Three places, identical text.
 *
 *   2. The "Run preview now" button that hits POST /api/agent/preview
 *      and renders the digest the agent would post if the cron ran
 *      right now. Zero checks consumed; the preview is rendered from
 *      the team's existing flag history without any LLM call.
 *
 *   3. A "Connect to GitHub" placeholder. The GitHub App registration
 *      is a Robert action (out-of-repo). Once the App is registered
 *      and credentials are in Vercel env, this stub becomes the real
 *      OAuth handoff (Dependabot / Renovate pattern).
 *
 * Server component for the chrome; the preview pane is a client
 * island in agent-preview-island.tsx so the "Run preview now"
 * interaction stays interactive without a full-page reload.
 */

import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { Card } from "@/components/ui/card";
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

export default async function AgentPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in?redirect_url=/dashboard/agent");
  }

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

      <AgentPreviewIsland />
    </div>
  );
}
