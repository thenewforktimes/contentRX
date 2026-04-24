/**
 * Refinement-signals aggregation helpers.
 *
 * Human-eval build plan Session 34 activation. The nightly candidate-
 * detector (`tools/refinement_candidate_detector.py`) consumes a
 * `SignalDump` JSON blob. This module takes raw rows from the
 * production DB and shapes them into the detector's input schema.
 *
 * Pure functions only — the /api/admin/refinement-signals route
 * executes the SQL, passes arrays in, and returns the shaped output.
 * Lets us test the math without a DB.
 *
 * Session 2 review-reason subtypes (mirror `REVIEW_*` constants in
 * `src/content_checker/models.py`):
 */
export const OUT_OF_DISTRIBUTION = "out_of_distribution";
export const STANDARDS_CONFLICT = "standards_conflict";

// ---------------------------------------------------------------------------
// Input row shapes (what the SQL returns)
// ---------------------------------------------------------------------------

export interface ViolationRow {
  checkEventId: string | null;
  standardId: string;
  moment: string | null;
  contentType: string;
  textHash: string;
  source: string;
  reviewReasonSubtype: string | null;
  createdAt: Date;
}

export interface OverrideRow {
  standardId: string;
  overrideReasonCode: string | null;
  userId: string;
  actorRole: string | null;
  textHash: string;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Output shapes (match tools/refinement_candidate_detector.py)
// ---------------------------------------------------------------------------

export interface StandardSignal {
  standard_id: string;
  fires_90d: number;
  total_evaluations_90d: number;
  fires_30d: number;
  overrides_30d: number;
  co_firing_standards_30d: Record<string, number>;
  unique_fires_30d: number;
}

export interface OverrideCluster {
  standard_id: string;
  reason_code: string;
  count_30d: number;
  distinct_actors: number;
  sample_text_hashes: string[];
}

export interface OODCluster {
  moment: string | null;
  content_type: string | null;
  case_count_60d: number;
  distinct_sources: number;
  sample_text_hashes: string[];
  representative_note: string | null;
}

export interface ConflictCluster {
  standard_ids: string[];
  count_30d: number;
  distinct_sources: number;
}

export interface SignalDump {
  generated_at: string;
  standards: StandardSignal[];
  override_clusters: OverrideCluster[];
  ood_clusters: OODCluster[];
  conflict_clusters: ConflictCluster[];
  standard_first_seen: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Aggregators
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

interface AggregateInput {
  now: Date;
  /** Violations in the last 90 days (caller filters). */
  violations90d: readonly ViolationRow[];
  /** Overrides in the last 30 days (caller filters). */
  overrides30d: readonly OverrideRow[];
  /** Violations in the last 60 days with a review_reason_subtype (for OOD/conflict). */
  reviewViolations60d: readonly ViolationRow[];
  /** First-seen date per standard, ISO 8601 (optional). */
  standardFirstSeen?: Readonly<Record<string, string>>;
}

export function buildSignalDump(input: AggregateInput): SignalDump {
  return {
    generated_at: input.now.toISOString(),
    standards: buildStandardSignals(
      input.violations90d,
      input.overrides30d,
      input.now,
    ),
    override_clusters: buildOverrideClusters(input.overrides30d),
    ood_clusters: buildOODClusters(input.reviewViolations60d),
    conflict_clusters: buildConflictClusters(
      input.reviewViolations60d,
      input.now,
    ),
    standard_first_seen: { ...(input.standardFirstSeen ?? {}) },
  };
}

// Group violations by checkEventId → list of rows from the same check.
function groupByCheckEvent(
  rows: readonly ViolationRow[],
): Map<string, ViolationRow[]> {
  const out = new Map<string, ViolationRow[]>();
  for (const r of rows) {
    if (!r.checkEventId) continue;
    const bucket = out.get(r.checkEventId) ?? [];
    bucket.push(r);
    out.set(r.checkEventId, bucket);
  }
  return out;
}

export function buildStandardSignals(
  violations90d: readonly ViolationRow[],
  overrides30d: readonly OverrideRow[],
  now: Date,
): StandardSignal[] {
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);

  // Per-standard counters.
  const fires90 = new Map<string, number>();
  const fires30 = new Map<string, number>();
  const overrides30 = new Map<string, number>();

  // For co-firing + unique fires we group by checkEventId first.
  const checkGroups30 = new Map<string, ViolationRow[]>();

  for (const v of violations90d) {
    fires90.set(v.standardId, (fires90.get(v.standardId) ?? 0) + 1);
    if (v.createdAt >= thirtyDaysAgo) {
      fires30.set(v.standardId, (fires30.get(v.standardId) ?? 0) + 1);
      if (v.checkEventId) {
        const g = checkGroups30.get(v.checkEventId) ?? [];
        g.push(v);
        checkGroups30.set(v.checkEventId, g);
      }
    }
  }

  for (const o of overrides30d) {
    overrides30.set(
      o.standardId,
      (overrides30.get(o.standardId) ?? 0) + 1,
    );
  }

  // Co-firing map per standard: {otherStandardId → count of checks
  // where this standard fired alongside the other}.
  const coFiring = new Map<string, Map<string, number>>();
  const uniqueFires = new Map<string, number>();

  for (const checkRows of checkGroups30.values()) {
    const distinct = new Set(checkRows.map((r) => r.standardId));
    for (const sid of distinct) {
      // If only this standard fired on this check, increment unique.
      if (distinct.size === 1) {
        uniqueFires.set(sid, (uniqueFires.get(sid) ?? 0) + 1);
      } else {
        const others = [...distinct].filter((o) => o !== sid);
        const bucket =
          coFiring.get(sid) ?? new Map<string, number>();
        for (const o of others) {
          bucket.set(o, (bucket.get(o) ?? 0) + 1);
        }
        coFiring.set(sid, bucket);
      }
    }
  }

  // `total_evaluations_90d` is the number of distinct check events that
  // had *any* violation in the window. Fires-90d over this gives the
  // base rate. It's a lower-bound (passes don't land in violations),
  // and the detector's threshold math accepts it as such — documented
  // in `refinement_candidate_detector.py`.
  const distinctCheckEvents90 = new Set<string>();
  for (const v of violations90d) {
    if (v.checkEventId) distinctCheckEvents90.add(v.checkEventId);
  }
  const totalEvaluations90 = distinctCheckEvents90.size;

  const standardIds = new Set<string>([
    ...fires90.keys(),
    ...overrides30.keys(),
  ]);

  const out: StandardSignal[] = [];
  for (const sid of standardIds) {
    const coMap = coFiring.get(sid);
    const coObj: Record<string, number> = {};
    if (coMap) {
      for (const [k, v] of coMap) coObj[k] = v;
    }
    out.push({
      standard_id: sid,
      fires_90d: fires90.get(sid) ?? 0,
      total_evaluations_90d: totalEvaluations90,
      fires_30d: fires30.get(sid) ?? 0,
      overrides_30d: overrides30.get(sid) ?? 0,
      co_firing_standards_30d: coObj,
      unique_fires_30d: uniqueFires.get(sid) ?? 0,
    });
  }
  out.sort((a, b) => a.standard_id.localeCompare(b.standard_id));
  return out;
}

export function buildOverrideClusters(
  overrides30d: readonly OverrideRow[],
  sampleCap = 3,
): OverrideCluster[] {
  const buckets = new Map<
    string,
    { count: number; actors: Set<string>; samples: string[] }
  >();

  for (const o of overrides30d) {
    if (!o.overrideReasonCode) continue;
    const key = `${o.standardId}|${o.overrideReasonCode}`;
    const bucket =
      buckets.get(key) ?? { count: 0, actors: new Set(), samples: [] };
    bucket.count += 1;
    bucket.actors.add(o.userId);
    if (bucket.samples.length < sampleCap && !bucket.samples.includes(o.textHash)) {
      bucket.samples.push(o.textHash);
    }
    buckets.set(key, bucket);
  }

  const out: OverrideCluster[] = [];
  for (const [key, bucket] of buckets) {
    const [standard_id, reason_code] = key.split("|");
    out.push({
      standard_id: standard_id!,
      reason_code: reason_code!,
      count_30d: bucket.count,
      distinct_actors: bucket.actors.size,
      sample_text_hashes: bucket.samples,
    });
  }
  out.sort(
    (a, b) =>
      b.count_30d - a.count_30d ||
      a.standard_id.localeCompare(b.standard_id),
  );
  return out;
}

export function buildOODClusters(
  reviewViolations60d: readonly ViolationRow[],
  sampleCap = 3,
): OODCluster[] {
  // Group by check event first — each OOD cluster counts *checks*, not
  // violations. A single check with 4 OOD-tagged violations counts as
  // one case.
  const byCheck = groupByCheckEvent(
    reviewViolations60d.filter(
      (v) => v.reviewReasonSubtype === OUT_OF_DISTRIBUTION,
    ),
  );

  const clusters = new Map<
    string,
    {
      moment: string | null;
      contentType: string | null;
      cases: number;
      sources: Set<string>;
      samples: string[];
    }
  >();

  for (const rows of byCheck.values()) {
    // All rows in a check share moment + content_type (they came from
    // the same evaluation).
    const head = rows[0]!;
    const key = `${head.moment ?? ""}|${head.contentType ?? ""}`;
    const bucket =
      clusters.get(key) ?? {
        moment: head.moment,
        contentType: head.contentType,
        cases: 0,
        sources: new Set(),
        samples: [],
      };
    bucket.cases += 1;
    bucket.sources.add(head.source);
    if (
      bucket.samples.length < sampleCap &&
      !bucket.samples.includes(head.textHash)
    ) {
      bucket.samples.push(head.textHash);
    }
    clusters.set(key, bucket);
  }

  const out: OODCluster[] = [];
  for (const bucket of clusters.values()) {
    out.push({
      moment: bucket.moment,
      content_type: bucket.contentType,
      case_count_60d: bucket.cases,
      distinct_sources: bucket.sources.size,
      sample_text_hashes: bucket.samples,
      representative_note: null,
    });
  }
  out.sort((a, b) => b.case_count_60d - a.case_count_60d);
  return out;
}

export function buildConflictClusters(
  reviewViolations60d: readonly ViolationRow[],
  now: Date,
): ConflictCluster[] {
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);

  // Conflict cluster = set of standards that appeared together on the
  // same check whose review_reason_subtype = standards_conflict.
  const byCheck = groupByCheckEvent(
    reviewViolations60d.filter(
      (v) =>
        v.reviewReasonSubtype === STANDARDS_CONFLICT &&
        v.createdAt >= thirtyDaysAgo,
    ),
  );

  const clusters = new Map<
    string,
    { ids: string[]; count: number; sources: Set<string> }
  >();

  for (const rows of byCheck.values()) {
    const ids = [...new Set(rows.map((r) => r.standardId))].sort();
    if (ids.length < 2) continue; // not a multi-standard conflict
    const key = ids.join("|");
    const bucket =
      clusters.get(key) ?? { ids, count: 0, sources: new Set() };
    bucket.count += 1;
    for (const r of rows) bucket.sources.add(r.source);
    clusters.set(key, bucket);
  }

  const out: ConflictCluster[] = [];
  for (const bucket of clusters.values()) {
    out.push({
      standard_ids: bucket.ids,
      count_30d: bucket.count,
      distinct_sources: bucket.sources.size,
    });
  }
  out.sort(
    (a, b) =>
      b.count_30d - a.count_30d ||
      a.standard_ids.join(",").localeCompare(b.standard_ids.join(",")),
  );
  return out;
}
