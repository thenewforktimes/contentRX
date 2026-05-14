/**
 * `/admin/overrides` — override inbox.
 *
 * Lists `violation_overrides` rows for triage. Every dismissal lands
 * here as `open`; the founder picks a resolution per row:
 *
 *   - addressed_patch   → route into the patch queue (P1–P5)
 *   - not_actionable    → the pilot was wrong; rule fired correctly
 *
 * Per ADR 2026-05-11 the override row is a private record. The
 * plaintext-and-corpus-contribution path moved to the Flag-for-Review
 * surface (`/admin/customer-flags`); overrides no longer feed
 * calibration directly.
 *
 * Filters via URL query params: `?user=<id>&standard=<id>&status=open|all`.
 * Default view: open overrides in the last 30 days.
 *
 * Auth via `src/app/admin/layout.tsx`.
 */

import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { Button, buttonStyles } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getDb, schema } from "@/db";
import {
  inboxCounts,
  loadOverrideInbox,
  triageOverride,
  type OverrideStatus,
} from "@/lib/admin/override-inbox";
import { isContentRXAdmin } from "@/lib/graduation";
import { humanizeMoment } from "@/lib/humanize";

export const metadata = {
  title: "Override inbox · ContentRX admin",
  robots: { index: false, follow: false },
};

const STATUS_LABEL: Record<OverrideStatus, string> = {
  open: "Open",
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
    newStatus !== "addressed_patch" &&
    newStatus !== "not_actionable"
  ) {
    return;
  }

  const { userId: clerkId } = await auth();
  if (!clerkId) return;
  // Defense-in-depth: re-check the founder gate at the action
  // boundary. The /admin layout enforces it on render, but Server
  // Actions are independently POSTable RPCs so we cannot rely on
  // the layout alone (see admin/reports/actions.ts:74-80 for the
  // canonical pattern). Round 3 audit caught three actions
  // missing this — overrides, customer-flags, costs.
  if (!isContentRXAdmin(clerkId)) return;
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
        <h1 className="text-2xl font-semibold text-strong">
          Override inbox
        </h1>
        <p className="mt-1 text-sm text-quiet">
          Triage every dismissal into the patch queue or mark
          not-actionable. Last 30 days, sorted most-recent-first.
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
        <section className="text-xs text-quiet">
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
        <p className="rounded-lg border border-line bg-raised p-6 text-sm text-quiet">
          No overrides match. Inbox zero — or the filter is too tight.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-lg border border-line bg-raised p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="text-xs text-quiet">
                  <p className="font-medium text-strong">
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
                  <p className="font-mono text-default">
                    {row.standardId}
                  </p>
                  {row.moment && (
                    <p className="text-quiet">
                      {humanizeMoment(row.moment)}
                    </p>
                  )}
                </div>
              </div>
              {(row.overrideReasonCode || row.overrideReason) && (
                <p className="mt-2 text-sm text-default">
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
              <p className="mt-3 rounded-md border border-line bg-overlay p-2 text-xs text-quiet">
                Hash only. Plaintext is never stored on override rows.
                Calibration contributions come through
                /admin/customer-flags.
              </p>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-quiet">
                <span>
                  Status:{" "}
                  <span className="font-medium text-default">
                    {STATUS_LABEL[row.status]}
                  </span>
                </span>
              </p>
              {row.status === "open" && (
                <TriageForm
                  overrideId={row.id}
                  action={triageAction}
                />
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
      <Input
        type="text"
        name="notes"
        placeholder="Optional one-line note"
        className="flex-1 min-w-[180px] py-1 text-xs"
      />
      <Button
        type="submit"
        name="newStatus"
        value="addressed_patch"
        size="sm"
      >
        Route to patch
      </Button>
      <button
        type="submit"
        name="newStatus"
        value="not_actionable"
        className={buttonStyles({ variant: "secondary", size: "sm" })}
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
    ? "bg-accent-primary text-accent-primary-on"
    : "bg-sunken text-default hover:bg-hover";
  return (
    <a
      href={href}
      // aria-current for AT announcement of the active filter (color-
      // only otherwise). focus-visible ring for keyboard users. WCAG
      // 4.1.2 + 2.4.7.
      aria-current={active ? "page" : undefined}
      className={`rounded-full px-3 py-1 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${tone}`}
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
