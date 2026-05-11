/**
 * Promote founder/admin account(s) to the Team plan. Founder utility.
 *
 * Why this exists: plan-gated pages (`/dashboard/overrides`,
 * `/dashboard/members`, etc.) check `user.plan === "team"`. Founder
 * admin status (`isContentRXAdmin` via `CONTENTRX_ADMIN_CLERK_IDS`) is
 * a separate axis — a founder whose `users.plan` is "free" or "pro"
 * still hits the upsell card on those pages. This script flips the
 * stored plan so the founder sees the same UI customers see, without
 * needing a paid Stripe subscription.
 *
 * Targets every Clerk ID in `CONTENTRX_ADMIN_CLERK_IDS`. Leaves
 * `teamOwnerUserId` as-is (NULL for a founder = "owns their own team",
 * which is the correct state for a single-seat founder).
 *
 * Idempotent. Re-running on someone already on "team" is a no-op.
 *
 * Usage (via npm — picks up the local node_modules/.bin/dotenv, so it
 * works even when a Python venv has shadowed the global `dotenv` on PATH):
 *
 *   # Always dry-run first
 *   npm run promote-admin -- --dry-run
 *
 *   # Actually flip the plan
 *   npm run promote-admin
 *
 * Wired into package.json the same way `reset-usage` is.
 */

import { eq, inArray } from "drizzle-orm";
import { argv, exit } from "node:process";
import { getDb, schema } from "../src/db";

type Args = {
  dryRun: boolean;
};

function parseArgs(): Args {
  const out: Args = { dryRun: false };
  for (const a of argv.slice(2)) {
    if (a === "--dry-run") out.dryRun = true;
  }
  return out;
}

function parseAdminIds(): string[] {
  const raw = process.env.CONTENTRX_ADMIN_CLERK_IDS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const db = getDb();
  const adminIds = parseAdminIds();

  if (adminIds.length === 0) {
    console.error(
      "CONTENTRX_ADMIN_CLERK_IDS is unset or empty. Nothing to promote.",
    );
    exit(2);
  }

  const rows = await db
    .select({
      id: schema.users.id,
      clerkId: schema.users.clerkId,
      email: schema.users.email,
      plan: schema.users.plan,
      teamOwnerUserId: schema.users.teamOwnerUserId,
    })
    .from(schema.users)
    .where(inArray(schema.users.clerkId, adminIds));

  if (rows.length === 0) {
    console.error(
      `No users.row matches any of the ${adminIds.length} Clerk IDs in CONTENTRX_ADMIN_CLERK_IDS.`,
    );
    console.error("Has the admin account signed in at least once?");
    exit(1);
  }

  console.log(`Found ${rows.length} admin row(s):`);
  for (const r of rows) {
    const teamNote = r.teamOwnerUserId
      ? ` (currently a member of team ${r.teamOwnerUserId})`
      : "";
    console.log(`  ${r.email}  plan=${r.plan}${teamNote}`);
  }

  const needsUpdate = rows.filter((r) => r.plan !== "team");
  if (needsUpdate.length === 0) {
    console.log("All admin rows already on plan=team. Nothing to do.");
    exit(0);
  }

  console.log("");
  console.log(`Would update ${needsUpdate.length} row(s) to plan=team:`);
  for (const r of needsUpdate) {
    console.log(`  ${r.email}: ${r.plan} -> team`);
  }

  if (args.dryRun) {
    console.log("");
    console.log("(dry run — no changes written)");
    exit(0);
  }

  for (const r of needsUpdate) {
    await db
      .update(schema.users)
      .set({ plan: "team" })
      .where(eq(schema.users.id, r.id));
    console.log(`Updated ${r.email}: plan=team`);
  }

  console.log("");
  console.log("Done. The plan-gated pages will now render the full UI for");
  console.log("these accounts. Stripe is untouched — no subscription was");
  console.log("created or modified. A future Stripe event for this account");
  console.log("could overwrite the plan column; re-run this script if so.");
  exit(0);
}

main().catch((err) => {
  console.error(err);
  exit(2);
});
