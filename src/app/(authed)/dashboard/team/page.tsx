/**
 * `/dashboard/team` — placeholder index that redirects to the only
 * existing child surface today.
 *
 * The /dashboard/team route group has one child:
 * `/custom-examples`. With no parent index, navigating to
 * `/dashboard/team` returned a Vercel default 404 (caught in the
 * pre-beta empty-state audit, before customers would have hit it).
 *
 * Picked redirect over a landing page because there's only one child.
 * If team-scoped surfaces multiply (members, billing-share, etc.)
 * this redirect becomes a thin landing with links to each. Until
 * then the redirect keeps the URL surface honest: parent paths
 * resolve.
 *
 * Members management lives at /dashboard/members (separate route);
 * team rules at /dashboard/rules. Both are linked from the folder-
 * tab nav. /dashboard/team is reserved for team-customization
 * surfaces — currently just custom examples.
 */

import { redirect } from "next/navigation";

export default function DashboardTeamIndex() {
  redirect("/dashboard/team/custom-examples");
}
