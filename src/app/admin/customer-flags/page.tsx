/**
 * `/admin/customer-flags` — customer flag inbox.
 *
 * Customers click "Flag for review" on a check result and consent to
 * sharing the original text. Each flag lands here as `open`. The
 * founder picks one of four resolutions:
 *
 *   - addressed_corpus     → added to the eval corpus as a calibration
 *                            example (the customer was right; pin it)
 *   - addressed_taxonomy   → routed into a standards-library
 *                            refinement (rule needs adjustment)
 *   - addressed_patch      → fix landed elsewhere (engine prompt,
 *                            suggestion-quality screen, etc.)
 *   - not_actionable       → flagged in good faith but no model change
 *                            is the right response (thanks for the
 *                            heads-up, the rule fired correctly)
 *
 * The customer's plaintext is shown unconditionally — the existence
 * of the row implies per-flag consent. Distinct from /admin/overrides
 * where text is gated behind a separate contributeUpstream opt-in.
 *
 * Auth via `src/app/admin/layout.tsx`.
 */

import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Pill, type PillTone } from "@/components/ui/pill";
import { getDb, schema } from "@/db";
import {
  flagInboxCounts,
  loadFlagInbox,
  triageFlag,
  type FlagReason,
  type FlagStatus,
} from "@/lib/admin/customer-flag-inbox";
import { humanizeContentType, humanizeMoment } from "@/lib/humanize";

export const metadata = {
  title: "Customer flags · ContentRX admin",
  robots: { index: false, follow: false },
};

const STATUS_LABEL: Record<FlagStatus, string> = {
  open: "Open",
  addressed_corpus: "Added to corpus",
  addressed_taxonomy: "Routed to taxonomy",
  // DB enum is `addressed_patch` for compatibility, but the customer-
  // facing label is "Fixed in engine" — no engineer-speak in the UI.
  addressed_patch: "Fixed in engine",
  not_actionable: "Not actionable",
};

const REASON_LABEL: Record<FlagReason, string> = {
  doesnt_match_experience: "Doesn't match the experience",
  lacks_context: "Lacks context",
  not_clear_helpful_concise: "Not clear, helpful, or concise",
};

/**
 * Defensive label lookup. Pre-audit rows in the DB carry the legacy
 * flag_reason enum values (wrong_verdict, etc.); after the audit,
 * TS narrows to the three new values but the text column could still
 * contain anything historical. Falls back to a sentence-cased rewrite
 * for unknowns so legacy rows render without crashing.
 */
function reasonLabel(value: string): string {
  if (value in REASON_LABEL) {
    return REASON_LABEL[value as FlagReason];
  }
  const spaced = value.replace(/_/g, " ").trim();
  return spaced.length > 0
    ? spaced.charAt(0).toUpperCase() + spaced.slice(1)
    : value;
}

// Six-tone Pill primitive doesn't include purple; addressed_taxonomy
// (rule promoted into the taxonomy) shares "info" semantics with
// addressed_patch — distinguished by the label text, not the tone.
const STATUS_PILL_TONE: Record<FlagStatus, PillTone> = {
  open: "amber",
  addressed_corpus: "emerald",
  addressed_taxonomy: "blue",
  addressed_patch: "blue",
  not_actionable: "neutral",
};

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

async function triageAction(formData: FormData) {
  "use server";
  const flagId = formData.get("flagId");
  const newStatus = formData.get("newStatus");
  const notes = formData.get("notes");
  if (typeof flagId !== "string" || typeof newStatus !== "string") return;
  if (
    newStatus !== "addressed_corpus" &&
    newStatus !== "addressed_taxonomy" &&
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

  await triageFlag({
    flagId,
    newStatus,
    triagedBy: user.id,
    notes: typeof notes === "string" && notes.length > 0 ? notes : undefined,
  });
  revalidatePath("/admin/customer-flags");
  revalidatePath("/admin");
}

export default async function AdminCustomerFlagsPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const statusFilter = isStatusFilter(params.status) ? params.status : "open";

  const [rows, counts] = await Promise.all([
    loadFlagInbox({ status: statusFilter }),
    flagInboxCounts(),
  ]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-strong">
            Customer flags
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-quiet">
            Cases customers consented to share for review. Plaintext is
            visible because every row carries explicit per-flag consent.
            Triage into corpus, taxonomy, engine fix, or not-actionable.
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl font-semibold tabular-nums text-strong">
            {counts.open}
          </p>
          <p className="text-xs text-quiet">
            open of {counts.total} total
          </p>
        </div>
      </header>

      <nav
        aria-label="Status filter"
        className="flex flex-wrap gap-2 border-b border-line pb-3"
      >
        {(["open", "all"] as const).map((s) => (
          <a
            key={s}
            href={s === "open" ? "/admin/customer-flags" : `/admin/customer-flags?status=${s}`}
            className={[
              "inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium transition",
              statusFilter === s
                ? "border-strong bg-strong text-canvas"
                : "border-line text-quiet hover:border-line-strong hover:text-strong",
            ].join(" ")}
          >
            {s === "open" ? `Open (${counts.open})` : `All (${counts.total})`}
          </a>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong bg-raised p-6 text-center text-sm text-quiet">
          {statusFilter === "open"
            ? "No open flags. Customers haven't sent anything for review yet."
            : "No flags in the window."}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-lg border border-line bg-raised p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Pill tone={STATUS_PILL_TONE[row.status]}>
                    {STATUS_LABEL[row.status]}
                  </Pill>
                  <Pill tone="neutral">{reasonLabel(row.flagReason)}</Pill>
                  {row.verdict && (
                    <span className="text-quiet">
                      Verdict: {row.verdict}
                    </span>
                  )}
                  {row.contentType && (
                    <span className="text-quiet">
                      · {humanizeContentType(row.contentType)}
                    </span>
                  )}
                  {row.moment && (
                    <span className="text-quiet">
                      · {humanizeMoment(row.moment)}
                    </span>
                  )}
                  <span className="text-quiet">· {row.source}</span>
                </div>
                <div className="text-right text-xs text-quiet">
                  <p>{row.userEmail ?? "(deleted user)"}</p>
                  <p>{formatRelative(row.createdAt)}</p>
                </div>
              </div>

              <p className="mt-3 whitespace-pre-wrap rounded-md border border-line bg-sunken p-3 font-mono text-sm text-default">
                {row.text}
              </p>

              {row.customerNote && (
                <p className="mt-2 rounded-md border border-line bg-sunken p-3 text-sm text-default">
                  <span className="font-semibold">Note:</span>{" "}
                  {row.customerNote}
                </p>
              )}

              {row.status === "open" && (
                <form
                  action={triageAction}
                  className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3"
                >
                  <input type="hidden" name="flagId" value={row.id} />
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="font-medium text-default">
                      Resolution
                    </span>
                    <Select name="newStatus" required defaultValue="">
                      <option value="" disabled>
                        Pick one…
                      </option>
                      <option value="addressed_corpus">
                        Add to corpus (calibration example)
                      </option>
                      <option value="addressed_taxonomy">
                        Refine taxonomy (rule needs work)
                      </option>
                      <option value="addressed_patch">
                        Fixed in engine (no rule change)
                      </option>
                      <option value="not_actionable">Not actionable</option>
                    </Select>
                  </label>
                  <label className="flex flex-1 flex-col gap-1 text-xs">
                    <span className="font-medium text-default">
                      Notes (optional)
                    </span>
                    <Input
                      type="text"
                      name="notes"
                      maxLength={500}
                      placeholder="Triage notes for the audit log"
                    />
                  </label>
                  <Button type="submit" size="sm">
                    Triage
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function isStatusFilter(value: string | undefined): value is "open" | "all" {
  return value === "open" || value === "all";
}

function formatRelative(date: Date): string {
  const elapsed = Date.now() - date.getTime();
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
