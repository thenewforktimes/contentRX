/**
 * /admin/rule-review — cross-team override aggregation.
 *
 * BUILD_PLAN_v2 Session 13. Internal admin surface for the product
 * owner. Shows standards with ≥25% override rate across ≥20 teams
 * sorted by total override count (impact). The "release notes that
 * justify model updates with data, not opinion" surface.
 *
 * Gated by `CONTENTRX_ADMIN_CLERK_IDS` — same env var that gates
 * graduation approval. Not exposed in any dashboard link; admins
 * know the URL.
 *
 * Privacy: aggregates across teams, so no single user's override
 * is identifiable here. Only standard_id counts + rates are shown.
 */

import { and, gte, isNotNull, sql } from "drizzle-orm";
import Link from "next/link";
import { getDb, schema } from "@/db";
import {
  aggregateRuleReview,
  DEFAULT_MIN_OVERRIDE_RATE,
  DEFAULT_MIN_TEAMS,
  DEFAULT_MIN_VIOLATIONS_PER_TEAM,
  type TeamCount,
} from "@/lib/admin-rule-review";

const DAY_MS = 24 * 60 * 60 * 1000;

type PageProps = {
  searchParams: Promise<{
    min_teams?: string;
    min_rate?: string;
    min_violations?: string;
    window?: string;
  }>;
};

export default async function AdminRuleReviewPage({ searchParams }: PageProps) {
  // Auth gate is at `src/app/admin/layout.tsx` (Phase B1). The layout
  // calls `isContentRXAdmin()` and either redirects unauthenticated
  // requests to /sign-in or 404s non-founders. By the time this page
  // renders, we know the request is from a founder.

  const params = await searchParams;
  const windowDays = clampInt(params.window, 30, 7, 180);
  const minTeams = clampInt(
    params.min_teams,
    DEFAULT_MIN_TEAMS,
    1,
    500,
  );
  const minRate = clampFloat(
    params.min_rate,
    DEFAULT_MIN_OVERRIDE_RATE,
    0,
    1,
  );
  const minViolations = clampInt(
    params.min_violations,
    DEFAULT_MIN_VIOLATIONS_PER_TEAM,
    1,
    1000,
  );

  const since = new Date(Date.now() - windowDays * DAY_MS);

  const db = getDb();
  const violationRows = (await db
    .select({
      teamId: schema.violations.teamId,
      standardId: schema.violations.standardId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.violations)
    .where(
      and(
        gte(schema.violations.createdAt, since),
        isNotNull(schema.violations.teamId),
      ),
    )
    .groupBy(schema.violations.teamId, schema.violations.standardId)) as Array<{
    teamId: string | null;
    standardId: string;
    count: number;
  }>;

  const overrideRows = (await db
    .select({
      teamId: schema.violationOverrides.teamId,
      standardId: schema.violationOverrides.standardId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.violationOverrides)
    .where(
      and(
        gte(schema.violationOverrides.createdAt, since),
        isNotNull(schema.violationOverrides.teamId),
      ),
    )
    .groupBy(
      schema.violationOverrides.teamId,
      schema.violationOverrides.standardId,
    )) as Array<{
    teamId: string | null;
    standardId: string;
    count: number;
  }>;

  const violations: TeamCount[] = violationRows
    .filter((r): r is TeamCount => r.teamId !== null)
    .map((r) => ({
      teamId: r.teamId,
      standardId: r.standardId,
      count: Number(r.count),
    }));
  const overrides: TeamCount[] = overrideRows
    .filter((r): r is TeamCount => r.teamId !== null)
    .map((r) => ({
      teamId: r.teamId,
      standardId: r.standardId,
      count: Number(r.count),
    }));

  const rows = aggregateRuleReview({
    violations,
    overrides,
    minTeams,
    minOverrideRate: minRate,
    minViolationsPerTeam: minViolations,
  });

  const distinctTeams = new Set(violations.map((v) => v.teamId)).size;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 text-sm">
      <header className="mb-8">
        <p className="text-xs font-mono uppercase tracking-widest text-stone-500 dark:text-stone-400">
          Admin · rule-review queue
        </p>
        <h1 className="mt-2 text-2xl font-semibold">
          Standards teams override most
        </h1>
        <p className="mt-2 max-w-prose text-stone-600 dark:text-stone-400">
          Rules with ≥{Math.round(minRate * 100)}% override rate on ≥
          {minTeams} distinct teams over the last {windowDays} days.
          Use this to justify content-model updates with data. The
          minimum-violations-per-team floor ({minViolations}) filters
          noise — a team that fires a rule twice and dismisses once
          shouldn&apos;t drive retirement decisions.
        </p>
      </header>

      <section className="mb-6 grid grid-cols-3 gap-4">
        <StatCard label="Distinct teams with violations" value={distinctTeams.toString()} />
        <StatCard label="Standards surfaced" value={rows.length.toString()} />
        <StatCard label="Window" value={`${windowDays}d`} />
      </section>

      <ThresholdForm
        windowDays={windowDays}
        minTeams={minTeams}
        minRate={minRate}
        minViolations={minViolations}
      />

      <section className="mt-8">
        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-stone-300 p-6 text-sm text-stone-500 dark:text-stone-400 dark:border-stone-700">
            No standards meet the thresholds in this window. Either
            the team population is too small or no standard is widely
            contested.
          </p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wider text-stone-500 dark:text-stone-400 dark:border-stone-800">
                <th className="py-2">Standard</th>
                <th className="py-2 text-right">Teams qualifying</th>
                <th className="py-2 text-right">Teams with data</th>
                <th className="py-2 text-right">Total overrides</th>
                <th className="py-2 text-right">Median rate</th>
                <th className="py-2 text-right">Max rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.standardId}
                  className="border-b border-stone-100 dark:border-stone-900"
                >
                  <td className="py-2 font-mono text-xs">
                    <Link
                      href={`https://docs.contentrx.io/model/standards/${r.standardId}`}
                      target="_blank"
                      className="underline underline-offset-2"
                    >
                      {r.standardId}
                    </Link>
                  </td>
                  <td className="py-2 text-right font-mono text-xs">
                    {r.teamsQualifying}
                  </td>
                  <td className="py-2 text-right font-mono text-xs text-stone-500 dark:text-stone-400">
                    {r.teamsWithData}
                  </td>
                  <td className="py-2 text-right font-mono text-xs">
                    {r.totalOverrides.toLocaleString()}
                  </td>
                  <td className="py-2 text-right font-mono text-xs">
                    {Math.round(r.medianOverrideRate * 100)}%
                  </td>
                  <td className="py-2 text-right font-mono text-xs">
                    {Math.round(r.maxOverrideRate * 100)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function ThresholdForm({
  windowDays,
  minTeams,
  minRate,
  minViolations,
}: {
  windowDays: number;
  minTeams: number;
  minRate: number;
  minViolations: number;
}) {
  return (
    <form
      method="get"
      action="/admin/rule-review"
      className="flex flex-wrap items-end gap-4 rounded-lg border border-stone-200 p-4 dark:border-stone-800"
    >
      <NumberInput label="Window (days)" name="window" defaultValue={windowDays} min={7} max={180} />
      <NumberInput label="Min teams" name="min_teams" defaultValue={minTeams} min={1} max={500} />
      <NumberInput
        label="Min override rate"
        name="min_rate"
        defaultValue={minRate}
        min={0}
        max={1}
        step={0.05}
      />
      <NumberInput
        label="Min violations per team"
        name="min_violations"
        defaultValue={minViolations}
        min={1}
        max={1000}
      />
      <button
        type="submit"
        className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 dark:bg-white dark:text-black"
      >
        Apply
      </button>
    </form>
  );
}

function NumberInput({
  label,
  name,
  defaultValue,
  min,
  max,
  step,
}: {
  label: string;
  name: string;
  defaultValue: number;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <label className="flex flex-col text-xs text-stone-600 dark:text-stone-400">
      {label}
      <input
        type="number"
        name={name}
        defaultValue={defaultValue}
        min={min}
        max={max}
        step={step ?? 1}
        className="mt-1 w-28 rounded-md border border-stone-300 bg-transparent px-2 py-1 font-mono text-xs dark:border-stone-700"
      />
    </label>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
      <p className="text-xs uppercase tracking-wider text-stone-500 dark:text-stone-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function clampInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt((raw ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function clampFloat(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseFloat((raw ?? "").trim());
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
