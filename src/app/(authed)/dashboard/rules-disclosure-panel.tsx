/**
 * Brief rules-disclosure panel on the dashboard home.
 *
 * Phase 7 of the pre-pilot launch build. A pilot pasting their first
 * string into Try-a-check should be able to see, in one click, what
 * patterns ContentRX is actually checking against. The full read-
 * only catalog lives at /dashboard/rules; this is the teaser that
 * answers "what is this thing reviewing?" without leaving the home
 * view.
 *
 * Server component. Pure render — no client interactivity beyond the
 * native `<details>` toggle. Substrate `id` never reaches this view
 * (CATEGORIES is consumed for `name` + `standards.length` only).
 */

import Link from "next/link";
import { CATEGORIES } from "@/lib/standards";

interface Props {
  /** Number of standards the team has disabled. Subtracted from
   * total active. Server pulls this from `team_rules` for the
   * caller's team-owner pivot. */
  disabledCount: number;
  /** Number of custom team-add rules. Surfaced as a footnote so the
   * count is honest about what's running. */
  customRuleCount: number;
}

export function RulesDisclosurePanel({
  disabledCount,
  customRuleCount,
}: Props) {
  const totalStandards = CATEGORIES.reduce(
    (sum, cat) => sum + cat.standards.length,
    0,
  );
  const activeCount = Math.max(0, totalStandards - disabledCount);

  return (
    <details className="group rounded-lg border border-stone-200 p-5 dark:border-stone-800">
      <summary className="flex cursor-pointer items-center justify-between gap-3 list-none">
        <div>
          <h2 className="text-sm font-semibold">
            What your team&apos;s rules check for
          </h2>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
            {activeCount} active patterns
            {disabledCount > 0 && ` (${disabledCount} disabled)`}
            {customRuleCount > 0 &&
              ` plus ${customRuleCount} custom team rule${customRuleCount === 1 ? "" : "s"}`}
            .
          </p>
        </div>
        <span
          aria-hidden
          className="text-xs text-stone-500 group-open:rotate-180 transition dark:text-stone-400"
        >
          ▾
        </span>
      </summary>
      <div className="mt-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
        {CATEGORIES.map((category) => (
          <div
            key={category.name}
            className="rounded-md border border-stone-200 p-3 dark:border-stone-800"
          >
            <p className="font-semibold text-stone-900 dark:text-stone-100">
              {category.name}
            </p>
            <p className="mt-1 text-stone-600 dark:text-stone-400">
              {category.standards.length} pattern
              {category.standards.length === 1 ? "" : "s"}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-4 text-xs">
        <Link
          href="/dashboard/rules"
          className="underline underline-offset-2 hover:text-stone-700 dark:hover:text-stone-200"
        >
          See every rule with examples
        </Link>
      </div>
    </details>
  );
}
