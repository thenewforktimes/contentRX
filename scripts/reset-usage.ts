/**
 * Reset a user's monthly check count. Founder utility.
 *
 * Use cases:
 *   - Robo testing the dashboard end-to-end and burning through 20
 *     free checks faster than he can write a doc
 *   - A paid customer who hit a billing edge case and needs the
 *     month re-zeroed (rare; usually the Stripe Customer Portal
 *     handles this via plan changes)
 *
 * Always run with --dry-run first. The script prints before / after
 * counts so you can verify it picked the right user before
 * committing.
 *
 * Usage:
 *
 *   # See free-plan accounts and pick one
 *   dotenv -e .env.local -- tsx scripts/reset-usage.ts --list-free
 *
 *   # Dry run for a specific email
 *   dotenv -e .env.local -- tsx scripts/reset-usage.ts \
 *     --email=robo@example.com --dry-run
 *
 *   # Actually reset
 *   dotenv -e .env.local -- tsx scripts/reset-usage.ts \
 *     --email=robo@example.com
 *
 * The reset deletes the (user_id, current_month) row from `usage`.
 * The dashboard / hot path treat a missing row as count=0.
 */

import { and, eq } from "drizzle-orm";
import { argv, exit } from "node:process";
import { getDb, schema } from "../src/db";
import { currentMonth } from "../src/lib/quotas";

type Args = {
  email: string | null;
  listFree: boolean;
  dryRun: boolean;
};

function parseArgs(): Args {
  const out: Args = { email: null, listFree: false, dryRun: false };
  for (const a of argv.slice(2)) {
    if (a === "--list-free") out.listFree = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a.startsWith("--email=")) out.email = a.slice("--email=".length);
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const db = getDb();
  const month = currentMonth();

  if (args.listFree) {
    const rows = await db
      .select({
        email: schema.users.email,
        plan: schema.users.plan,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .where(eq(schema.users.plan, "free"));
    if (rows.length === 0) {
      console.log("No free-plan accounts found.");
      exit(0);
    }
    console.log(`Free-plan accounts (${rows.length}):`);
    for (const row of rows) {
      console.log(`  ${row.email}  (created ${row.createdAt?.toISOString() ?? "?"})`);
    }
    exit(0);
  }

  if (!args.email) {
    console.error(
      "Pass --email=<address> or --list-free. See script docstring for examples.",
    );
    exit(2);
  }

  const [user] = await db
    .select({ id: schema.users.id, plan: schema.users.plan })
    .from(schema.users)
    .where(eq(schema.users.email, args.email))
    .limit(1);

  if (!user) {
    console.error(`No user with email "${args.email}".`);
    exit(1);
  }

  const [usage] = await db
    .select({ count: schema.usage.count })
    .from(schema.usage)
    .where(
      and(eq(schema.usage.userId, user.id), eq(schema.usage.month, month)),
    )
    .limit(1);

  const before = usage?.count ?? 0;
  console.log(`User:   ${args.email}`);
  console.log(`Plan:   ${user.plan}`);
  console.log(`Month:  ${month}`);
  console.log(`Before: ${before} checks`);

  if (args.dryRun) {
    console.log("(dry run — no changes written)");
    exit(0);
  }

  if (before === 0) {
    console.log("Already at 0. Nothing to do.");
    exit(0);
  }

  await db
    .delete(schema.usage)
    .where(
      and(eq(schema.usage.userId, user.id), eq(schema.usage.month, month)),
    );

  console.log(`After:  0 checks. Reset complete.`);
  exit(0);
}

main().catch((err) => {
  console.error(err);
  exit(2);
});
