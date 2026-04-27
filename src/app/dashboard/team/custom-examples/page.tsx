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
 * Free / Pro users see an upsell card. Team-member (non-owner)
 * users see a 403 explanation (mirrors /dashboard/overrides).
 */

import { auth } from "@clerk/nextjs/server";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { CUSTOM_EXAMPLES_CAP_PER_TEAM } from "@/lib/custom-examples";
import { getOrProvisionUser } from "@/lib/user-provisioning";
import { DeleteExampleButton } from "./delete-example-button";

export const metadata = {
  title: "Custom examples — ContentRX",
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
      <section className="rounded-lg border border-neutral-200 p-6 text-sm dark:border-neutral-800">
        <p>We&apos;re finishing setting up your account. Refresh in a moment.</p>
      </section>
    );
  }

  if (user.plan !== "team") {
    return (
      <section className="flex flex-col items-start gap-3 rounded-lg border border-neutral-200 p-6 dark:border-neutral-800">
        <h1 className="text-lg font-semibold">Custom examples</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Custom examples are a Team-plan feature. They let your team
          mark specific strings as correct (or known-bad) for your
          product&apos;s voice — ContentRX short-circuits those
          strings on every subsequent check without running the LLM,
          without weakening any global rule.
        </p>
        <Link
          href="/dashboard"
          className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 dark:bg-white dark:text-black"
        >
          Upgrade to Team
        </Link>
      </section>
    );
  }

  const isAdmin = user.teamOwnerUserId === null;
  if (!isAdmin) {
    return (
      <section className="flex flex-col items-start gap-3 rounded-lg border border-neutral-200 p-6 dark:border-neutral-800">
        <h1 className="text-lg font-semibold">Custom examples</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Only the team owner manages custom examples. The set applies
          to every team member&apos;s checks — matching strings
          short-circuit the LLM and return the team&apos;s stored
          verdict. Ask your team owner if a phrasing you&apos;re
          seeing flagged should be added or removed.
        </p>
      </section>
    );
  }

  const entries = await db
    .select()
    .from(schema.teamCustomExamples)
    .where(eq(schema.teamCustomExamples.teamOwnerUserId, user.id))
    .orderBy(desc(schema.teamCustomExamples.createdAt));

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-6 flex flex-col gap-2">
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">
          Team plan · audit view
        </p>
        <h1 className="text-2xl font-semibold">Custom examples</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {entries.length} of {CUSTOM_EXAMPLES_CAP_PER_TEAM}. Each
          entry short-circuits <code>/api/check</code> for your team
          — matching strings skip the LLM entirely and return the
          stored verdict. The core model stays untouched.
        </p>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
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
        <section className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-6 text-sm dark:border-neutral-700 dark:bg-neutral-900">
          <p className="text-neutral-700 dark:text-neutral-300">
            No custom examples yet. Add one with{" "}
            <code className="rounded bg-white px-1 py-0.5 dark:bg-neutral-950">
              contentrx example add &quot;Let&apos;s go.&quot; --verdict pass
              --moment confirmation
            </code>
            .
          </p>
        </section>
      ) : (
        <section className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
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
                  className="border-b border-neutral-100 dark:border-neutral-900"
                >
                  <td className="max-w-[280px] truncate py-2 pr-4 font-mono text-xs">
                    <span title={e.text}>{e.text}</span>
                    {e.notes && (
                      <p className="mt-1 text-[11px] font-normal text-neutral-500">
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
                      <span className="text-neutral-500">any</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-xs">
                    {e.contentType ? (
                      <code className="font-mono">{e.contentType}</code>
                    ) : (
                      <span className="text-neutral-500">any</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-xs">
                    {e.standardId ? (
                      <code className="font-mono">{e.standardId}</code>
                    ) : (
                      <span className="text-neutral-500">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-xs">
                    {e.contributeUpstream ? (
                      <span className="rounded-full border border-green-300 bg-green-50 px-2 py-0.5 text-[10px] text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
                        upstream
                      </span>
                    ) : (
                      <span className="text-neutral-500">private</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-xs text-neutral-500 tabular-nums">
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
  const className =
    verdict === "pass"
      ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
      : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300";
  return (
    <span
      className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${className}`}
    >
      {verdict}
    </span>
  );
}

function formatDate(d: Date): string {
  try {
    return d.toISOString().slice(0, 10);
  } catch {
    return String(d);
  }
}
