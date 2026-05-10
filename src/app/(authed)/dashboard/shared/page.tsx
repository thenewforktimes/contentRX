/**
 * `/dashboard/shared` — every check this customer has shared with
 * ContentRX via Flag for Review.
 *
 * Per ADR 2026-05-11 this surface is the customer's window into "what
 * has ContentRX seen of mine." It must be bulletproof:
 *
 *   - Lists only rows belonging to the signed-in user. No team-scoped
 *     bleed. No admin-tier echoes.
 *   - Shows the consent context for every row: when shared, what
 *     reason the customer picked, the source surface, and the current
 *     triage status.
 *   - No aggregate stats above the list that could leak content
 *     between customers.
 *   - Per-card "Remove this check" button that calls
 *     DELETE /api/customer-flag/[id]. In-product revoke is the
 *     baseline right; email is the fallback for edge cases.
 *
 * Auth: Clerk session via the (authed) layout. Server Component; reads
 * directly from the DB.
 */

import { auth } from "@clerk/nextjs/server";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import { getDb, schema } from "@/db";
import { humanizeMoment } from "@/lib/humanize";
import { getOrProvisionUser } from "@/lib/user-provisioning";
import { RevokeButton } from "./revoke-button";

export const metadata = {
  title: "Shared checks · ContentRX",
};

const REASON_LABEL: Record<string, string> = {
  doesnt_match_experience: "Did not match the experience",
  lacks_context: "Lacked context",
  not_clear_helpful_concise: "Not clear, helpful, or concise",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Awaiting review",
  addressed_corpus: "Added to calibration corpus",
  addressed_taxonomy: "Folded into engine reasoning",
  addressed_patch: "Routed to a rule fix",
  not_actionable: "Reviewed, no change",
};

const STATUS_TONE: Record<string, "stone" | "emerald" | "amber"> = {
  open: "stone",
  addressed_corpus: "emerald",
  addressed_taxonomy: "emerald",
  addressed_patch: "emerald",
  not_actionable: "amber",
};

export default async function SharedChecksPage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    redirect("/sign-in?redirect_url=/dashboard/shared");
  }
  const user = await getOrProvisionUser(clerkId);
  if (!user) {
    return (
      <section className="rounded-lg border border-line p-6 text-sm">
        <p>
          ContentRX is finishing setting up your account. Refresh in a
          moment.
        </p>
      </section>
    );
  }

  const db = getDb();

  // Strict user-scope. The query never crosses to teamId; nothing on
  // this surface is team-shared. Each customer sees only what they
  // themselves consented to share.
  const rows = await db
    .select({
      id: schema.customerFlaggedReviews.id,
      text: schema.customerFlaggedReviews.text,
      contentType: schema.customerFlaggedReviews.contentType,
      moment: schema.customerFlaggedReviews.moment,
      verdict: schema.customerFlaggedReviews.verdict,
      flagReason: schema.customerFlaggedReviews.flagReason,
      customerNote: schema.customerFlaggedReviews.customerNote,
      source: schema.customerFlaggedReviews.source,
      consentRecordedAt: schema.customerFlaggedReviews.consentRecordedAt,
      status: schema.customerFlaggedReviews.status,
    })
    .from(schema.customerFlaggedReviews)
    .where(eq(schema.customerFlaggedReviews.userId, user.id))
    .orderBy(desc(schema.customerFlaggedReviews.consentRecordedAt));

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Eyebrow>Shared with ContentRX</Eyebrow>
        <h1 className="mt-2 text-2xl font-semibold text-strong">
          Checks you have shared
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-default">
          Every check here was shared deliberately, by tapping
          {" "}
          <span className="font-medium text-strong">Flag for review</span>
          {" "}
          and confirming the consent modal. ContentRX stores nothing
          else from the originating run.
        </p>
        <p className="mt-2 max-w-2xl text-sm text-default">
          To remove a check, use the{" "}
          <span className="font-medium text-strong">Remove this check</span>
          {" "}
          button on the card. ContentRX deletes the row and any record
          it produced in the calibration log.
        </p>
      </header>

      {rows.length === 0 ? (
        <section className="rounded-lg border border-line bg-overlay p-6">
          <p className="text-sm text-default">
            Nothing shared yet. ContentRX has no plaintext of any check
            you have run. To share a specific check, run it and tap{" "}
            <span className="font-medium text-strong">Flag for review</span>
            {" "}
            on the result.
          </p>
        </section>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => {
            const reason =
              REASON_LABEL[row.flagReason] ?? row.flagReason;
            const status = STATUS_LABEL[row.status] ?? row.status;
            const tone = STATUS_TONE[row.status] ?? "stone";
            return (
              <li
                key={row.id}
                className="rounded-lg border border-line bg-raised p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="text-xs text-quiet">
                    Shared{" "}
                    {row.consentRecordedAt
                      .toISOString()
                      .slice(0, 16)
                      .replace("T", " ")}
                    {" UTC · "}
                    via {row.source}
                  </div>
                  <Pill tone={tone}>{status}</Pill>
                </div>
                <p className="mt-3 whitespace-pre-wrap rounded-md border border-line bg-canvas px-3 py-2 font-mono text-sm text-strong">
                  {row.text}
                </p>
                <dl className="mt-3 grid grid-cols-1 gap-2 text-xs text-default sm:grid-cols-2">
                  <div>
                    <dt className="font-medium text-quiet">Reason</dt>
                    <dd>{reason}</dd>
                  </div>
                  {row.customerNote && (
                    <div>
                      <dt className="font-medium text-quiet">Your note</dt>
                      <dd className="italic">{row.customerNote}</dd>
                    </div>
                  )}
                  {row.moment && (
                    <div>
                      <dt className="font-medium text-quiet">Moment</dt>
                      <dd>{humanizeMoment(row.moment)}</dd>
                    </div>
                  )}
                  {row.contentType && (
                    <div>
                      <dt className="font-medium text-quiet">Content type</dt>
                      <dd>{row.contentType}</dd>
                    </div>
                  )}
                  {row.verdict && (
                    <div>
                      <dt className="font-medium text-quiet">
                        Engine verdict at share time
                      </dt>
                      <dd>{row.verdict}</dd>
                    </div>
                  )}
                </dl>
                <div className="mt-3 flex justify-end">
                  <RevokeButton id={row.id} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <footer className="text-xs text-quiet">
        ContentRX maintains a private record of consent for each row
        above. The full consent contract lives at{" "}
        <Link href="/ethics" className="underline underline-offset-2">
          /ethics
        </Link>
        {" "}
        and{" "}
        <Link href="/privacy" className="underline underline-offset-2">
          /privacy
        </Link>
        .
      </footer>
    </div>
  );
}
