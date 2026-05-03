/**
 * Read-only rules catalog for Free / Pro / Scale plans.
 *
 * Phase 6 of the pre-pilot launch build. Renders the rule catalog
 * as plain-language descriptions with correct/incorrect examples —
 * no substrate identifiers, no edit affordances.
 *
 * The data shape this component receives is intentionally narrower
 * than the substrate `StandardSummary`: page.tsx strips `id` and
 * `category` slug before handing it down so the type system can't
 * accidentally render a substrate identifier.
 */

import Link from "next/link";
import { Pill } from "@/components/ui/pill";

interface PublicStandard {
  rule: string;
  correct: string;
  incorrect: string;
  disabled: boolean;
}

interface PublicCategory {
  name: string;
  standards: PublicStandard[];
}

export function ReadOnlyRulesView({
  categories,
  customRuleCount,
}: {
  categories: PublicCategory[];
  customRuleCount: number;
}) {
  const totalActive = categories.reduce(
    (sum, cat) => sum + cat.standards.filter((s) => !s.disabled).length,
    0,
  );
  const totalDisabled = categories.reduce(
    (sum, cat) => sum + cat.standards.filter((s) => s.disabled).length,
    0,
  );

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm dark:border-stone-800 dark:bg-stone-900">
        <p className="font-medium text-stone-900 dark:text-stone-100">
          {totalActive} active patterns reviewing your content
        </p>
        <p className="mt-1 text-xs text-stone-600 dark:text-stone-300">
          {totalDisabled > 0 &&
            `${totalDisabled} disabled by your team. `}
          {customRuleCount > 0 &&
            `${customRuleCount} custom team rule${customRuleCount === 1 ? "" : "s"} on top. `}
          Edit on the Team plan.{" "}
          <Link
            href="/pricing"
            className="underline underline-offset-2"
          >
            See pricing
          </Link>
          .
        </p>
      </section>

      {categories.map((category) => {
        const activeStandards = category.standards.filter(
          (s) => !s.disabled,
        );
        if (activeStandards.length === 0 && category.standards.length > 0) {
          return null;
        }
        return (
          <section key={category.name}>
            <h2 className="mb-3 text-sm font-semibold">{category.name}</h2>
            <ul className="flex flex-col gap-2">
              {category.standards.map((std, idx) => (
                <RuleCard key={`${category.name}-${idx}`} standard={std} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function RuleCard({ standard }: { standard: PublicStandard }) {
  return (
    <li
      className={`rounded-md border p-3 text-sm dark:border-stone-800 ${
        standard.disabled
          ? "border-stone-200 bg-stone-50 opacity-60 dark:bg-stone-900"
          : "border-stone-200 bg-white dark:bg-stone-950"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-stone-900 dark:text-stone-100">
          {standard.rule}
        </p>
        {standard.disabled && (
          <Pill tone="neutral" size="xs" className="uppercase tracking-wide">
            Disabled by team
          </Pill>
        )}
      </div>
      <dl className="mt-2 grid grid-cols-1 gap-1 text-xs text-stone-600 dark:text-stone-400 sm:grid-cols-[80px_1fr]">
        <dt className="font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
          Correct
        </dt>
        <dd>{standard.correct}</dd>
        <dt className="font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-400">
          Avoid
        </dt>
        <dd>{standard.incorrect}</dd>
      </dl>
    </li>
  );
}
