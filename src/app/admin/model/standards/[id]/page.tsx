/**
 * `/admin/model/standards/[id]` — single standard detail.
 *
 * Phase B2 of the post-pivot rolling plan. Surfaces the full
 * substrate for one standard: rule, examples, version + version
 * history, sources, influences, content_type_notes, and the moment
 * context map (every moment that emphasizes / relaxes / suppresses
 * this standard, with rationale).
 *
 * Auth handled by `src/app/admin/layout.tsx`.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { Pill } from "@/components/ui/pill";
import {
  getMomentsTouchingStandard,
  getStandardById,
} from "@/lib/admin-substrate.server";
import {
  attentionReasons,
  getStandardActivity,
} from "@/lib/admin/standard-activity";

export const metadata = {
  title: "Standard · ContentRX admin",
  robots: { index: false, follow: false },
};

export default async function AdminStandardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const standard = getStandardById(id);
  if (!standard) notFound();

  const momentContexts = getMomentsTouchingStandard(id);
  const activity = await getStandardActivity(id);
  const reasons = attentionReasons(activity);

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs">
          <Link
            href="/admin/model"
            className="text-quiet hover:underline"
          >
            ← Back to model
          </Link>
        </p>
        <div className="mt-2 flex flex-wrap items-baseline gap-3">
          <h1 className="font-mono text-xl text-strong">
            {standard.id}
          </h1>
          <span className="font-mono text-xs text-quiet">
            v{standard.version} · {standard.category_name} ({standard.category_id})
          </span>
          <Pill tone="neutral" size="xs" className="uppercase tracking-wide">
            {standard.rule_type}
          </Pill>
        </div>
        <p className="mt-3 text-sm text-default">
          {standard.rule}
        </p>
      </header>

      <ActivityPanel standardId={id} activity={activity} reasons={reasons} />

      <section className="grid gap-3 sm:grid-cols-2">
        <ExampleBlock label="Pass" tone="pass" text={standard.correct} />
        <ExampleBlock label="Fail" tone="fail" text={standard.incorrect} />
      </section>

      {standard.relevant_content_types.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-quiet">
            Relevant content types
          </h2>
          <ul className="flex flex-wrap gap-2">
            {standard.relevant_content_types.map((ct) => (
              <li key={ct}>
                <Pill tone="neutral">{ct}</Pill>
              </li>
            ))}
          </ul>
        </section>
      )}

      {Object.keys(standard.content_type_notes).length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-quiet">
            Content-type notes
          </h2>
          <dl className="space-y-3">
            {Object.entries(standard.content_type_notes).map(([ct, note]) => (
              <div
                key={ct}
                className="rounded-lg border border-line bg-white p-3 dark:bg-stone-900"
              >
                <dt className="font-mono text-xs text-quiet">{ct}</dt>
                <dd className="mt-1 whitespace-pre-line text-sm text-default">
                  {note}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {momentContexts.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-quiet">
            Moment context ({momentContexts.length})
          </h2>
          <ul className="space-y-2">
            {momentContexts.map(({ moment, weight }) => (
              <li
                key={moment.id}
                className="rounded-lg border border-line bg-white p-3 dark:bg-stone-900"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <Link
                    href={`/admin/model/moments/${moment.id}`}
                    className="font-mono text-xs text-default hover:underline"
                  >
                    {moment.id}
                  </Link>
                  <Pill
                    tone={
                      weight.modifier === "emphasize"
                        ? "emerald"
                        : weight.modifier === "relax"
                          ? "amber"
                          : "neutral"
                    }
                    size="xs"
                    className="uppercase tracking-wide"
                  >
                    {weight.modifier}
                  </Pill>
                </div>
                <p className="mt-1 text-sm text-default">
                  {weight.rationale}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {standard.influences.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-quiet">
            Influences
          </h2>
          <ul className="space-y-2">
            {standard.influences.map((inf, i) => (
              <li
                key={`${inf.source}-${i}`}
                className="rounded-lg border border-line bg-white p-3 dark:bg-stone-900"
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-strong">
                    {inf.source}
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-quiet">
                    {inf.direction}
                  </span>
                </div>
                {inf.note && (
                  <p className="mt-1 text-sm text-default">
                    {inf.note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {standard.sources.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-quiet">
            Sources
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-default">
            {standard.sources.map((src, i) => (
              <li key={`${src}-${i}`}>{src}</li>
            ))}
          </ul>
        </section>
      )}

      {standard.version_history.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-quiet">
            Version history
          </h2>
          <ol className="space-y-2">
            {standard.version_history.map((entry, i) => (
              <li
                key={`${entry.version}-${i}`}
                className="rounded-lg border border-line bg-white p-3 dark:bg-stone-900"
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-xs text-default">
                    v{entry.version}
                  </span>
                  {entry.date && (
                    <span className="font-mono text-[10px] text-quiet">
                      {entry.date}
                    </span>
                  )}
                </div>
                {entry.change && (
                  <p className="mt-1 text-sm text-default">
                    {entry.change}
                  </p>
                )}
                {entry.notes && (
                  <p className="mt-1 text-xs text-quiet">
                    {entry.notes}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function ExampleBlock({
  label,
  tone,
  text,
}: {
  label: string;
  tone: "pass" | "fail";
  text: string;
}) {
  const classes =
    tone === "pass"
      ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950"
      : "border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950";
  const labelTone =
    tone === "pass"
      ? "text-emerald-800 dark:text-emerald-300"
      : "text-rose-800 dark:text-rose-300";
  return (
    <div className={`rounded-lg border p-3 ${classes}`}>
      <p
        className={`text-[10px] font-semibold uppercase tracking-wide ${labelTone}`}
      >
        {label}
      </p>
      <p className="mt-1 whitespace-pre-line text-sm text-strong">
        {text}
      </p>
    </div>
  );
}

/**
 * Activity panel — the cross-surface counts that turn this page from
 * "rule reference card" into "rule mission control." Each count is a
 * Link directly into the operational surface scoped to this standard,
 * so a founder reading the rule can jump straight to its open work.
 *
 * Shows a "Steady state" line when no signals are above threshold, so
 * the panel isn't visually empty for low-traffic rules — the silence
 * itself is the signal in that case.
 */
function ActivityPanel({
  standardId,
  activity,
  reasons,
}: {
  standardId: string;
  activity: import("@/lib/admin/standard-activity").StandardActivity;
  reasons: import("@/lib/admin/standard-activity").AttentionReason[];
}) {
  const isHot = reasons.length > 0;
  return (
    <section
      aria-labelledby="activity-heading"
      className={`rounded-lg border p-4 ${
        isHot
          ? "border-accent-caution-border bg-accent-caution-soft"
          : "border-line bg-raised"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="activity-heading"
          className={`text-sm font-semibold uppercase tracking-wide ${
            isHot ? "text-accent-caution-text" : "text-quiet"
          }`}
        >
          Activity
        </h2>
        {isHot && (
          <p className="text-xs text-accent-caution-text">
            {reasons.map((r) => r.label).join(" · ")}
          </p>
        )}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <ActivityLink
          label="Overrides last 7d"
          count={activity.overridesLast7d}
          href={`/admin/queue?standard=${encodeURIComponent(standardId)}`}
        />
        <ActivityLink
          label="Customer flags open"
          count={activity.customerFlagsOpen}
          href={`/admin/customer-flags`}
        />
        <ActivityLink
          label="Suggestion candidates"
          count={activity.suggestionCandidates}
          href={`/admin/suggestions`}
        />
      </div>
      {!isHot && (
        <p className="mt-3 text-xs text-quiet">
          Steady state. No signals above threshold for this rule right now.
        </p>
      )}
    </section>
  );
}

function ActivityLink({
  label,
  count,
  href,
}: {
  label: string;
  count: number;
  href: string;
}) {
  const isZero = count === 0;
  return (
    <Link
      href={href}
      className={`flex items-baseline justify-between gap-2 rounded-md border border-line bg-raised px-3 py-2 transition hover:border-line-strong hover:bg-hover ${
        isZero ? "opacity-60" : ""
      }`}
      aria-label={`${count} ${label}, jump to surface`}
    >
      <span className="text-xs text-quiet">{label}</span>
      <span className="font-mono text-base font-semibold text-strong tabular-nums">
        {count}
      </span>
    </Link>
  );
}
