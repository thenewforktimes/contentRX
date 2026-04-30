/**
 * `/admin/overrides` — override inbox.
 *
 * Phase 5 of the pre-pilot launch build. Lists `violation_overrides`
 * rows for triage. Every dismissal lands here as `open`; the founder
 * picks one of three resolutions per row from the action dropdown:
 *
 *   - addressed_corpus  → add the case to the eval corpus as a
 *                         `human_verdict: pass` example (most
 *                         common — the pilot was right)
 *   - addressed_patch   → route into the patch queue (P1–P5)
 *   - not_actionable    → the pilot was wrong; rule fired correctly
 *
 * Filters via URL query params: `?user=<id>&standard=<id>&status=open|all`.
 * Default view: open overrides in the last 30 days.
 *
 * Auth via `src/app/admin/layout.tsx`.
 */

import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import {
  inboxCounts,
  loadOverrideInbox,
  triageOverride,
  type OverrideStatus,
} from "@/lib/admin/override-inbox";

export const metadata = {
  title: "Override inbox · ContentRX admin",
  robots: { index: false, follow: false },
};

const STATUS_LABEL: Record<OverrideStatus, string> = {
  open: "Open",
  addressed_corpus: "Added to corpus",
  addressed_patch: "Routed to patch",
  not_actionable: "Not actionable",
};

interface PageProps {
  searchParams: Promise<{
    user?: string;
    standard?: string;
    status?: string;
  }>;
}

async function triageAction(formData: FormData) {
  "use server";
  const overrideId = formData.get("overrideId");
  const newStatus = formData.get("newStatus");
  const notes = formData.get("notes");
  if (typeof overrideId !== "string" || typeof newStatus !== "string") {
    return;
  }
  if (
    newStatus !== "addressed_corpus" &&
    newStatus !== "addressed_patch" &&
    newStatus !== "not_actionable"
  ) {
    return;
  }

  const { userId: clerkId } = await auth();
  if (!clerkId) return;
  const db = getDb();
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.clerkId, clerkId))
    .limit(1);
  if (!user) return;

  await triageOverride({
    overrideId,
    newStatus,
    triagedBy: user.id,
    notes: typeof notes === "string" && notes.length > 0 ? notes : undefined,
  });
  revalidatePath("/admin/overrides");
}

export default async function AdminOverridesPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const statusFilter: OverrideStatus | "all" =
    params.status === "all" ||
    params.status === "open" ||
    params.status === "addressed_corpus" ||
    params.status === "addressed_patch" ||
    params.status === "not_actionable"
      ? params.status
      : "open";

  const [rows, counts] = await Promise.all([
    loadOverrideInbox({
      userId: params.user,
      standardId: params.standard,
      status: statusFilter,
    }),
    inboxCounts(),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          Override inbox
        </h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Triage every dismissal into the corpus, the patch queue, or
          mark not-actionable. Last 30 days, sorted most-recent-first.
        </p>
      </header>

      <section
        className="flex flex-wrap gap-2 text-xs"
        aria-label="Status filter"
      >
        <FilterPill
          label={`Open · ${counts.open}`}
          href={buildHref(params, { status: "open" })}
          active={statusFilter === "open"}
        />
        <FilterPill
          label={`Corpus · ${counts.addressed_corpus}`}
          href={buildHref(params, { status: "addressed_corpus" })}
          active={statusFilter === "addressed_corpus"}
        />
        <FilterPill
          label={`Patch · ${counts.addressed_patch}`}
          href={buildHref(params, { status: "addressed_patch" })}
          active={statusFilter === "addressed_patch"}
        />
        <FilterPill
          label={`Not actionable · ${counts.not_actionable}`}
          href={buildHref(params, { status: "not_actionable" })}
          active={statusFilter === "not_actionable"}
        />
        <FilterPill
          label="All"
          href={buildHref(params, { status: "all" })}
          active={statusFilter === "all"}
        />
      </section>

      {(params.user || params.standard) && (
        <section className="text-xs text-neutral-600 dark:text-neutral-400">
          {params.user && <span>User: {params.user} · </span>}
          {params.standard && (
            <span>Standard: {params.standard} · </span>
          )}
          <a
            href={buildHref(params, { user: undefined, standard: undefined })}
            className="underline underline-offset-2"
          >
            clear filters
          </a>
        </section>
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
          No overrides match. Inbox zero — or the filter is too tight.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="text-xs text-neutral-600 dark:text-neutral-400">
                  <p className="font-medium text-neutral-900 dark:text-neutral-100">
                    {row.userEmail ?? row.userId ?? "(deleted user)"}
                  </p>
                  <p>
                    {row.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                    {" UTC · "}
                    {row.source}
                    {row.overrideStance ? ` · ${row.overrideStance}` : ""}
                  </p>
                </div>
                <div className="text-right text-xs">
                  <p className="font-mono text-neutral-700 dark:text-neutral-300">
                    {row.standardId}
                  </p>
                  {row.moment && (
                    <p className="text-neutral-500 dark:text-neutral-400">
                      {row.moment}
                    </p>
                  )}
                </div>
              </div>
              {(row.overrideReasonCode || row.overrideReason) && (
                <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
                  {row.overrideReasonCode && (
                    <span className="font-medium">
                      {row.overrideReasonCode.replace(/_/g, " ")}.{" "}
                    </span>
                  )}
                  {row.overrideReason && (
                    <span className="italic">{row.overrideReason}</span>
                  )}
                </p>
              )}
              <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                Status:{" "}
                <span className="font-medium text-neutral-700 dark:text-neutral-300">
                  {STATUS_LABEL[row.status]}
                </span>
              </p>
              {row.status === "open" && (
                <TriageForm overrideId={row.id} action={triageAction} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TriageForm({
  overrideId,
  action,
}: {
  overrideId: string;
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <form action={action} className="mt-3 flex flex-wrap items-center gap-2">
      <input type="hidden" name="overrideId" value={overrideId} />
      <input
        type="text"
        name="notes"
        placeholder="Optional one-line note"
        className="flex-1 min-w-[180px] rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
      />
      <button
        type="submit"
        name="newStatus"
        value="addressed_corpus"
        className="rounded-md bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-800 dark:bg-emerald-400 dark:text-emerald-950 dark:hover:bg-emerald-300"
      >
        Add to corpus
      </button>
      <button
        type="submit"
        name="newStatus"
        value="addressed_patch"
        className="rounded-md bg-amber-700 px-3 py-1 text-xs font-medium text-white hover:bg-amber-800 dark:bg-amber-400 dark:text-amber-950 dark:hover:bg-amber-300"
      >
        Route to patch
      </button>
      <button
        type="submit"
        name="newStatus"
        value="not_actionable"
        className="rounded-md bg-neutral-200 px-3 py-1 text-xs font-medium text-neutral-800 hover:bg-neutral-300 dark:bg-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-600"
      >
        Not actionable
      </button>
    </form>
  );
}

function FilterPill({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  const tone = active
    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
    : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700";
  return (
    <a
      href={href}
      className={`rounded-full px-3 py-1 font-medium transition ${tone}`}
    >
      {label}
    </a>
  );
}

function buildHref(
  current: { user?: string; standard?: string; status?: string },
  next: { user?: string | undefined; standard?: string | undefined; status?: string },
): string {
  const params = new URLSearchParams();
  const merged = {
    user: "user" in next ? next.user : current.user,
    standard: "standard" in next ? next.standard : current.standard,
    status: "status" in next ? next.status : current.status,
  };
  if (merged.user) params.set("user", merged.user);
  if (merged.standard) params.set("standard", merged.standard);
  if (merged.status) params.set("status", merged.status);
  const qs = params.toString();
  return qs ? `/admin/overrides?${qs}` : "/admin/overrides";
}
