/**
 * /dashboard/team/custom-examples — read-only audit view.
 *
 * Human-eval build plan Session 30 PR B. This surface is
 * deliberately audit-shaped, not workflow-shaped:
 *
 *   - Ingestion happens via MCP tools (`custom_example_add`) or CLI
 *     (`contentrx example add`). That's the positioning we settled
 *     on in the Session 30 UX conversation — MCP-first, CLI-second
 *     per Session 29's generation-layer lead.
 *   - This page lets the team owner see what's been added, sort /
 *     filter by verdict, and delete entries that should no longer
 *     short-circuit. No create form — ingestion belongs where the
 *     team is already authoring.
 *
 * Free / Pro users see an upsell card. Any team member (owner or
 * not) can manage custom examples — Position-3 product direction
 * (Apr 2026): no admin distinction, everyone gets the same
 * functionality.
 */

import { auth } from "@clerk/nextjs/server";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonStyles } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { getDb, schema } from "@/db";
import { CUSTOM_EXAMPLES_CAP_PER_TEAM } from "@/lib/custom-examples";
import { getOrProvisionUser } from "@/lib/user-provisioning";
import { DeleteExampleButton } from "./delete-example-button";

export const metadata = {
  title: "Custom examples. ContentRX",
};

export default async function CustomExamplesPage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    redirect("/sign-in?redirect_url=/dashboard/team/custom-examples");
  }

  const db = getDb();
  const user = await getOrProvisionUser(clerkId);
  if (!user) {
    return (
      <section className="rounded-lg border border-stone-200 p-6 text-sm dark:border-stone-800">
        <p>We&apos;re finishing setting up your account. Refresh in a moment.</p>
      </section>
    );
  }

  if (user.plan !== "team") {
    return (
      <section className="flex flex-col items-start gap-3 rounded-lg border border-stone-200 p-6 dark:border-stone-800">
        <h1 className="text-lg font-semibold">Custom examples</h1>
        <p className="text-sm text-stone-600 dark:text-stone-300">
          Available on the Team plan. Mark specific strings as correct
          (or known-bad) for your product&apos;s voice. ContentRX
          short-circuits those strings on every subsequent check
          without running the LLM, without weakening any global rule.
        </p>
        <Link href="/dashboard" className={buttonStyles({ size: "sm" })}>
          Upgrade to Team
        </Link>
      </section>
    );
  }

  const teamOwnerUserId = user.teamOwnerUserId ?? user.id;
  const entries = await db
    .select()
    .from(schema.teamCustomExamples)
    .where(eq(schema.teamCustomExamples.teamOwnerUserId, teamOwnerUserId))
    .orderBy(desc(schema.teamCustomExamples.createdAt));

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-6 flex flex-col gap-2">
        <p className="text-xs font-mono uppercase tracking-widest text-stone-500 dark:text-stone-400">
          Team plan · audit view
        </p>
        <h1 className="text-2xl font-semibold">Custom examples</h1>
        <p className="text-sm text-stone-600 dark:text-stone-300">
          {entries.length} of {CUSTOM_EXAMPLES_CAP_PER_TEAM}. Each
          entry short-circuits <code>/api/check</code> for your team:
          matching strings skip the LLM entirely and return the
          stored verdict. The core model stays untouched.
        </p>
        <p className="text-sm text-stone-600 dark:text-stone-300">
          <strong>Ingestion lives in MCP + CLI</strong> (not here).
          Add entries via <code>custom_example_add</code> from Claude
          Code / Cursor, or <code>contentrx example add</code> from
          your terminal. This page is for auditing + removal.
        </p>
        <p className="mt-3 text-xs">
          <Link
            href="https://docs.contentrx.io/guides/custom-examples"
            className="underline underline-offset-2"
          >
            Read the workflow guide →
          </Link>
        </p>
      </header>

      {entries.length === 0 ? (
        <section className="rounded-md border border-dashed border-stone-300 bg-stone-50 p-6 text-sm dark:border-stone-700 dark:bg-stone-900">
          <p className="text-stone-700 dark:text-stone-300">
            Nothing here yet. Your team hasn&apos;t added a custom example.
            From the terminal:{" "}
            <code className="rounded bg-white px-1 py-0.5 dark:bg-stone-950">
              contentrx example add &quot;Let&apos;s go.&quot; --verdict pass
              --moment confirmation
            </code>
            . Or add one from Claude Code / Cursor with the{" "}
            <code className="rounded bg-white px-1 py-0.5 dark:bg-stone-950">
              custom_example_add
            </code>{" "}
            MCP tool.
          </p>
        </section>
      ) : (
        <section className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500 dark:border-stone-800 dark:text-stone-400">
                <th className="py-2 pr-4">Text</th>
                <th className="py-2 pr-4">Verdict</th>
                <th className="py-2 pr-4">Moment</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">Standard</th>
                <th className="py-2 pr-4">Contributed</th>
                <th className="py-2 pr-4">Added</th>
                <th className="py-2 pr-4" />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr
                  key={e.id}
                  className="border-b border-stone-100 dark:border-stone-900"
                >
                  <td className="max-w-[280px] truncate py-2 pr-4 font-mono text-xs">
                    <span title={e.text}>{e.text}</span>
                    {e.notes && (
                      <p className="mt-1 text-[11px] font-normal text-stone-500 dark:text-stone-400">
                        {e.notes}
                      </p>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <VerdictPill verdict={e.verdict} />
                  </td>
                  <td className="py-2 pr-4 text-xs">
                    {e.moment ? (
                      <code className="font-mono">{e.moment}</code>
                    ) : (
                      <span className="text-stone-500 dark:text-stone-400">any</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-xs">
                    {e.contentType ? (
                      <code className="font-mono">{e.contentType}</code>
                    ) : (
                      <span className="text-stone-500 dark:text-stone-400">any</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-xs">
                    {e.standardId ? (
                      <code className="font-mono">{e.standardId}</code>
                    ) : (
                      <span className="text-stone-500 dark:text-stone-400">none</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-xs">
                    {e.contributeUpstream ? (
                      <Pill tone="emerald">Upstream</Pill>
                    ) : (
                      <Pill tone="stone">Private</Pill>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-xs text-stone-500 tabular-nums dark:text-stone-400">
                    {formatDate(e.createdAt)}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    <DeleteExampleButton id={e.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

function VerdictPill({ verdict }: { verdict: string }) {
  // Per ADR 2026-04-29 §9: customer surfaces use the calmer
  // language pattern. The substrate verdict stays `pass` /
  // `violation` (this is the team owner's pinned outcome for the
  // exact-match short-circuit), but the rendered label is
  // "Pass" / "Adjust" with amber for the latter (red is reserved
  // for ship-blockers per the color rule).
  if (verdict === "pass") {
    return <Pill tone="emerald">Pass</Pill>;
  }
  return <Pill tone="amber">Adjust</Pill>;
}

function formatDate(d: Date): string {
  try {
    return d.toISOString().slice(0, 10);
  } catch {
    return String(d);
  }
}
