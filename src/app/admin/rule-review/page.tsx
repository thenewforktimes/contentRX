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
import { Input } from "@/components/ui/input";
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
        <h1 className="text-2xl font-semibold text-strong">
          Standards teams override most
        </h1>
        <p className="mt-1 max-w-prose text-sm text-quiet">
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
          <p className="rounded-md border border-dashed border-line-strong p-6 text-sm text-quiet">
            No standards meet the thresholds in this window. Either
            the team population is too small or no standard is widely
            contested.
          </p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-quiet">
                {/* scope="col" (WCAG 1.3.1) — SRs announce header with cell value */}
                <th scope="col" className="py-2">Standard</th>
                <th scope="col" className="py-2 text-right">Teams qualifying</th>
                <th scope="col" className="py-2 text-right">Teams with data</th>
                <th scope="col" className="py-2 text-right">Total overrides</th>
                <th scope="col" className="py-2 text-right">Median rate</th>
                <th scope="col" className="py-2 text-right">Max rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.standardId}
                  // hover lights up the row so a founder scanning a
                  // long list can see what they're hovering. Subtle
                  // bg-hover surface, no border change. WCAG-adjacent
                  // usability — admin scan density.
                  className="border-b border-line transition-colors hover:bg-hover"
                >
                  <td className="py-2 font-mono text-xs">
                    <Link
                      href={`/admin/model/standards/${r.standardId}`}
                      // visited locked to default so the standard id
                      // doesn't drop to browser-default purple after
                      // repeated visits. focus-visible ring so the
                      // keyboard tab path is visible. WCAG 2.4.7.
                      // Internal admin link — no target=_blank; the
                      // standard mission-control panel lives at
                      // /admin/model/standards/[id]. ADR 2026-04-25
                      // forbids public docs.contentrx.io paths that
                      // render standards by name.
                      className="rounded underline underline-offset-2 visited:text-default hover:text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-raised"
                    >
                      {r.standardId}
                    </Link>
                  </td>
                  <td className="py-2 text-right font-mono text-xs">
                    {r.teamsQualifying}
                  </td>
                  <td className="py-2 text-right font-mono text-xs text-quiet">
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
      className="flex flex-wrap items-end gap-4 rounded-lg border border-line p-4"
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
        // bg-strong / text-canvas is the monochrome high-contrast admin
        // pattern (not in the accent system). Hover shifts the bg from
        // text-strong → text-default, which reads as a slight "muting"
        // and preserves text-canvas contrast above 9.7:1 in both modes.
        className="rounded-md bg-strong px-3 py-1.5 text-xs font-medium text-canvas hover:bg-default"
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
    <label className="flex flex-col text-xs text-quiet">
      {label}
      <Input
        type="number"
        name={name}
        defaultValue={defaultValue}
        min={min}
        max={max}
        step={step ?? 1}
        className="mt-1 w-28 bg-transparent py-1 font-mono text-xs"
      />
    </label>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line p-4">
      <p className="text-xs uppercase tracking-wider text-quiet">{label}</p>
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
