/**
 * `/dashboard/checks/[id]` — single-check detail page.
 *
 * Round 3 (2026-05-10): the list view at /dashboard/checks gives the
 * verdict + finding count + 80-char preview; this page is where the
 * customer drills in to see exactly what was checked, what the
 * engine said, what they should consider, and what to do next.
 *
 * What this page shows that the list can't:
 *   - full input text (text_full column, populated post-PR-#TBD)
 *   - per-finding issue + suggestion + severity + category
 *   - doc-tier suggested rewrite + one-sentence diagnostic (when the
 *     input was long and the verdict wasn't "All clear")
 *   - Copy buttons on every chunk of text
 *   - Re-run CTA that re-issues /api/check with the stored input
 *   - Flag-for-review / Revoke (state-dependent on customer_flagged_reviews)
 *
 * Older checks gracefully degrade: rows that pre-date the text_full
 * column show the 80-char preview only and a clear "details not
 * retained for this check" empty state. Rows that have findings rows
 * without issue/suggestion (pre-2026-05-10) show severity + category
 * only with the same empty-state note.
 *
 * Privacy: text_full is the customer's own input, stored to surface
 * back to the customer. Same retention contract as text_preview per
 * ADR 2026-04-28 (customer-not-product). The detail page never
 * renders substrate (standard_id, rule_version) per ADR 2026-04-25.
 */

import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FlagForReview } from "@/components/flag-for-review";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill, type PillTone } from "@/components/ui/pill";
import { getDb, schema } from "@/db";
import {
  humanizeContentType,
  humanizeMoment,
  humanizeVerdict,
} from "@/lib/humanize";
import { getOrProvisionUser } from "@/lib/user-provisioning";
import { RevokeButton } from "../../shared/revoke-button";
import { CopyButton } from "./copy-button";
import { RecheckButton } from "./recheck-button";

interface PageProps {
  params: Promise<{ id: string }>;
}

const SOURCE_LABEL: Record<string, string> = {
  dashboard: "Paste panel",
  cli: "CLI",
  action: "GitHub Action",
  lsp: "Editor (LSP)",
  mcp: "Claude / Cursor",
};

const CATEGORY_TONE: Record<string, PillTone> = {
  "Voice & tone": "blue",
  Mechanics: "neutral",
  Structure: "neutral",
  Accessibility: "blue",
  Inclusion: "blue",
  "Big picture": "neutral",
};

export default async function CheckDetailPage({ params }: PageProps) {
  const { id } = await params;
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    redirect(`/sign-in?redirect_url=/dashboard/checks/${id}`);
  }

  const user = await getOrProvisionUser(clerkId);
  if (!user) {
    return (
      <section className="rounded-lg border border-line p-6 text-sm">
        <p>We&apos;re finishing setting up your account. Refresh in a moment.</p>
      </section>
    );
  }

  const ownerId = user.teamOwnerUserId ?? user.id;
  const db = getDb();

  // Team-scoped fetch — same scoping rule as the list view at
  // page.tsx so a teammate sees the owner's checks alongside their
  // own, and a not-on-team user sees only their own rows. Legacy
  // rows with team_id == null fall back to user_id, matching the
  // historical writes before team_id was always populated.
  const scopeClause = or(
    eq(schema.usageEvents.teamId, ownerId),
    and(
      isNull(schema.usageEvents.teamId),
      eq(schema.usageEvents.userId, user.id),
    ),
  );

  const [row] = await db
    .select({
      id: schema.usageEvents.id,
      createdAt: schema.usageEvents.createdAt,
      source: schema.usageEvents.source,
      contentType: schema.usageEvents.contentType,
      moment: schema.usageEvents.moment,
      verdict: schema.usageEvents.verdict,
      reviewReason: schema.usageEvents.reviewReason,
      violationCount: schema.usageEvents.violationCount,
      unitsConsumed: schema.usageEvents.unitsConsumed,
      textHash: schema.usageEvents.textHash,
      textPreview: schema.usageEvents.textPreview,
      textFull: schema.usageEvents.textFull,
      suggestedRewrite: schema.usageEvents.suggestedRewrite,
      suggestedDiagnostic: schema.usageEvents.suggestedDiagnostic,
    })
    .from(schema.usageEvents)
    .where(and(eq(schema.usageEvents.id, id), scopeClause))
    .limit(1);

  if (!row) {
    notFound();
  }

  // Findings join: usage_events.id ↔ violations.check_event_id was
  // wired in PR-#425 (2026-05-08). Pre-PR-#425 rows generated
  // independent cuids so this returns 0 rows for them — handled in
  // the renderer below.
  const findings = await db
    .select({
      id: schema.violations.id,
      severity: schema.violations.severity,
      issue: schema.violations.issue,
      suggestion: schema.violations.suggestion,
      category: schema.violations.category,
      createdAt: schema.violations.createdAt,
    })
    .from(schema.violations)
    .where(eq(schema.violations.checkEventId, id))
    .orderBy(asc(schema.violations.createdAt));

  // Flagged status — has the signed-in user flagged this exact text
  // via Flag-for-Review? User-scoped (the consent contract is
  // per-user, not per-team). Looked up by text_hash so historic
  // flags on the same string still match.
  let flagId: string | null = null;
  if (row.textHash) {
    const [flag] = await db
      .select({ id: schema.customerFlaggedReviews.id })
      .from(schema.customerFlaggedReviews)
      .where(
        and(
          eq(schema.customerFlaggedReviews.userId, user.id),
          eq(schema.customerFlaggedReviews.textHash, row.textHash),
        ),
      )
      .limit(1);
    flagId = flag?.id ?? null;
  }

  const { label: verdictLabel, tone: verdictTone } = humanizeVerdict(
    row.verdict ?? "pass",
    row.violationCount ?? 0,
  );

  const fullText = row.textFull ?? null;
  const previewText = row.textPreview ?? null;
  const displayText = fullText ?? previewText;
  const isTruncated = !fullText && previewText !== null;

  const renderableFindings = findings.filter(
    (f) => (f.issue && f.issue.length > 0) || (f.suggestion && f.suggestion.length > 0),
  );
  const findingsDetailMissing =
    (row.violationCount ?? 0) > 0 && renderableFindings.length === 0;

  const dateString = row.createdAt.toLocaleString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const metaParts = [
    row.source ? SOURCE_LABEL[row.source] ?? row.source : null,
    row.contentType ? humanizeContentType(row.contentType) : null,
    row.moment ? humanizeMoment(row.moment) : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link
          href="/dashboard/checks"
          className="mb-4 inline-block text-xs text-quiet hover:text-strong"
        >
          ← Back to recent checks
        </Link>
        <Eyebrow>Check detail</Eyebrow>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{verdictLabel}</h1>
          <Pill tone={verdictTone}>
            {row.violationCount === 1
              ? "1 finding"
              : `${row.violationCount} findings`}
          </Pill>
        </div>
        <p className="text-xs text-quiet">
          {dateString}
          {metaParts.length > 0 && ` · ${metaParts.join(" · ")}`}
          {` · ${row.unitsConsumed} ${row.unitsConsumed === 1 ? "check" : "checks"}`}
        </p>
      </header>

      {/* ─────────────── Doc-tier diagnostic + rewrite ─────────────── */}
      {row.suggestedDiagnostic && (
        <section className="rounded-lg border border-line bg-raised p-5">
          <div className="flex items-baseline justify-between gap-3">
            <Eyebrow>Diagnostic</Eyebrow>
          </div>
          <p className="mt-2 text-base text-strong">
            {row.suggestedDiagnostic}
          </p>
        </section>
      )}

      {row.suggestedRewrite && (
        <section className="rounded-lg border border-line bg-raised p-5">
          <div className="flex items-baseline justify-between gap-3">
            <Eyebrow>Suggested rewrite</Eyebrow>
            <CopyButton text={row.suggestedRewrite} label="Copy rewrite" />
          </div>
          <p className="mt-2 whitespace-pre-wrap font-mono text-sm text-default">
            {row.suggestedRewrite}
          </p>
          <p className="mt-3 text-xs text-quiet">
            A holistic pass through your input. Treat it as a starting
            draft. Keep what reads better, ignore what doesn&apos;t.
          </p>
        </section>
      )}

      {/* ─────────────── Findings ─────────────── */}
      <section className="rounded-lg border border-line bg-raised p-5">
        <Eyebrow>Findings</Eyebrow>
        {findingsDetailMissing ? (
          <p className="mt-3 rounded-md border border-dashed border-line bg-sunken p-4 text-sm text-default">
            This check ran before we started saving finding-level detail.
            The verdict and count are still on file, but the individual
            issue + suggestion text wasn&apos;t retained. Re-run the
            check below to see the current analysis.
          </p>
        ) : renderableFindings.length === 0 ? (
          <p className="mt-3 text-sm text-default">
            No findings on this check. The text read as clean against
            every standard we ran.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {renderableFindings.map((f) => (
              <li
                key={f.id}
                className="rounded-md border border-line bg-canvas p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {f.category && (
                    <Pill
                      size="xs"
                      tone={CATEGORY_TONE[f.category] ?? "neutral"}
                    >
                      {f.category}
                    </Pill>
                  )}
                  <Pill size="xs" tone={severityTone(f.severity)}>
                    {severityLabel(f.severity)}
                  </Pill>
                </div>
                {f.issue && (
                  <p className="mt-2 text-sm text-strong">{f.issue}</p>
                )}
                {f.suggestion && (
                  <div className="mt-2 flex items-start justify-between gap-2">
                    <p className="text-sm text-default">
                      <span className="font-medium text-strong">
                        Consider:
                      </span>{" "}
                      {f.suggestion}
                    </p>
                    <CopyButton
                      text={f.suggestion}
                      label="Copy"
                      className="mt-0.5"
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ─────────────── Input text ─────────────── */}
      <section className="rounded-lg border border-line bg-raised p-5">
        <div className="flex items-baseline justify-between gap-3">
          <Eyebrow>What you checked</Eyebrow>
          {displayText && (
            <CopyButton text={displayText} label="Copy text" />
          )}
        </div>
        {displayText ? (
          <>
            <p className="mt-2 whitespace-pre-wrap font-mono text-sm text-default">
              {displayText}
              {isTruncated && "…"}
            </p>
            {isTruncated && (
              <p className="mt-3 text-xs text-quiet">
                Only the first 80 characters of this check were stored.
                The full text isn&apos;t available for older checks.
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 text-sm italic text-quiet">
            Text not retained for this check.
          </p>
        )}
      </section>

      {/* ─────────────── Actions ─────────────── */}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-raised p-5">
        <div className="flex flex-wrap items-center gap-3">
          {flagId ? (
            <>
              <span className="text-sm font-medium text-accent-affirm-text">
                ✓ Shared for review
              </span>
              <RevokeButton id={flagId} />
            </>
          ) : displayText ? (
            <FlagForReview
              text={displayText}
              contentType={row.contentType}
              moment={row.moment}
              verdict={normalizeVerdict(row.verdict)}
              variant="card-action"
              label="Flag for review"
              source="dashboard"
            />
          ) : (
            <span className="text-sm text-quiet">
              We can&apos;t flag this for review because the original
              text wasn&apos;t saved. Run a fresh check to get this
              content reviewed.
            </span>
          )}
        </div>
        {fullText && <RecheckButton text={fullText} />}
      </section>

      <p className="text-xs text-quiet">
        Findings detail and the full input shown here are your own
        check results, retained so you can come back to them. Per our
        privacy contract we don&apos;t use this content for anything
        else.
      </p>
    </div>
  );
}

function severityTone(
  severity: string | null,
): "amber" | "red" | "stone" | "neutral" {
  if (severity === "high") return "red";
  if (severity === "medium") return "amber";
  if (severity === "low") return "stone";
  return "neutral";
}

function severityLabel(severity: string | null): string {
  if (severity === "high") return "High";
  if (severity === "medium") return "Medium";
  if (severity === "low") return "Low";
  return "Severity unknown";
}

function normalizeVerdict(
  verdict: string | null,
): "pass" | "violation" | "review_recommended" | null {
  if (
    verdict === "pass" ||
    verdict === "violation" ||
    verdict === "review_recommended"
  ) {
    return verdict;
  }
  return null;
}

