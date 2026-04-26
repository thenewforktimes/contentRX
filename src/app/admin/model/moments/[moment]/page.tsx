/**
 * `/admin/model/moments/[moment]` — single moment detail.
 *
 * Phase B2 of the post-pivot rolling plan. Shows the moment's
 * description, situation property, and the full list of standards it
 * weights (emphasize / relax / suppress) with rationale text.
 *
 * Auth handled by `src/app/admin/layout.tsx`.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getMomentById,
  getStandardById,
  type MomentWeight,
} from "@/lib/admin-substrate.server";

type Modifier = "emphasize" | "relax" | "suppress";

const MODIFIER_ORDER: Modifier[] = ["emphasize", "relax", "suppress"];

const MODIFIER_TONE: Record<Modifier, string> = {
  emphasize:
    "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  relax:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  suppress:
    "border-neutral-200 bg-neutral-50 text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300",
};

export const metadata = {
  title: "Moment · ContentRX admin",
  robots: { index: false, follow: false },
};

export default async function AdminMomentDetailPage({
  params,
}: {
  params: Promise<{ moment: string }>;
}) {
  const { moment: momentId } = await params;
  const moment = getMomentById(momentId);
  if (!moment) notFound();

  const grouped = groupWeightsByModifier(moment.weights);

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs">
          <Link
            href="/admin/model"
            className="text-neutral-600 hover:underline dark:text-neutral-400"
          >
            ← Back to model
          </Link>
        </p>
        <h1 className="mt-2 font-mono text-xl text-neutral-900 dark:text-neutral-100">
          {moment.id}
        </h1>
        <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
          {moment.description}
        </p>
        {moment.situation_property && (
          <p className="mt-3 text-xs">
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-medium uppercase tracking-wide text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
              {moment.situation_property}
            </span>
          </p>
        )}
      </header>

      {MODIFIER_ORDER.map((modifier) => {
        const entries = grouped[modifier];
        if (!entries || entries.length === 0) return null;
        return (
          <section key={modifier} className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              {modifier} ({entries.length})
            </h2>
            <ul className="space-y-2">
              {entries.map((w) => (
                <li
                  key={w.standard_id}
                  className={`rounded-lg border p-3 ${MODIFIER_TONE[modifier]}`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <Link
                      href={`/admin/model/standards/${w.standard_id}`}
                      className="font-mono text-xs hover:underline"
                    >
                      {w.standard_id}
                    </Link>
                    <span className="hidden font-mono text-[10px] opacity-60 sm:inline">
                      {standardRuleSnippet(w.standard_id)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm">{w.rationale}</p>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function groupWeightsByModifier(weights: MomentWeight[]) {
  const grouped: Partial<Record<Modifier, MomentWeight[]>> = {};
  for (const w of weights) {
    const m = w.modifier as Modifier;
    if (!grouped[m]) grouped[m] = [];
    grouped[m]!.push(w);
  }
  return grouped;
}

/** Tiny rule snippet for the right-hand side. Kept short so the row
 * stays on one line at typical widths. */
function standardRuleSnippet(standardId: string): string {
  const s = getStandardById(standardId);
  if (!s) return "";
  const r = s.rule;
  if (r.length <= 56) return r;
  return r.slice(0, 53) + "…";
}
