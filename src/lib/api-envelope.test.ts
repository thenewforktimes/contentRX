import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  envelope,
  publicCheckEnvelope,
  publicViolation,
  SCHEMA_VERSION,
} from "./api-envelope";

describe("api-envelope", () => {
  it("attaches schema_version and empty warnings by default", () => {
    const out = envelope({ result: { ok: true } });
    expect(out.schema_version).toBe(SCHEMA_VERSION);
    expect(out.warnings).toEqual([]);
    expect(out.result).toEqual({ ok: true });
  });

  it("passes through warnings when provided", () => {
    const out = envelope({ result: { x: 1 } }, { warnings: ["deprecated"] });
    expect(out.warnings).toEqual(["deprecated"]);
  });

  it("does not clobber existing fields in the payload", () => {
    const out = envelope({ a: 1, b: "two", c: [3] });
    expect(out.a).toBe(1);
    expect(out.b).toBe("two");
    expect(out.c).toEqual([3]);
    expect(out.schema_version).toBe(SCHEMA_VERSION);
  });

  it("SCHEMA_VERSION is valid semver", () => {
    expect(SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("SCHEMA_VERSION is 3.0.0 (length-routed metering, segment_type dropped)", () => {
    // 3.0.0 collapses the three-tier model into length-routed metering.
    // The /api/check request schema no longer accepts segment_type;
    // the response `metering.tier` field is renamed to `size_class`
    // and reflects the derived "small" / "large" label, not a
    // user-chosen tier.
    expect(SCHEMA_VERSION).toBe("3.0.0");
  });
});

const SUBSTRATE_VIOLATION_FIELDS = [
  "standard_id",
  "rule",
  "source",
  "related_standards",
  "ambiguity_flag",
  "rule_version",
  "validate_rejection_reason",
] as const;

const PUBLIC_VIOLATION_FIELDS = [
  "issue",
  "suggestion",
  "severity",
  "confidence",
  // 2.5.0 — customer-facing category derived from substrate
  // standard_id ("Voice & tone", "Mechanics", etc).
  "category",
] as const;

// Fields that MUST stay off the public envelope. content_type +
// moment moved off this list in 2.2.0 — they describe the customer's
// own classified input back to them and aren't substrate-only.
const SUBSTRATE_TOP_LEVEL_FIELDS = [
  "audience",
  "summary",
  "overall_verdict",
  "passes",
  "pipeline",
  "rationale_chain",
] as const;

function makeSubstrateViolation(): Record<string, unknown> {
  return {
    issue: "This destructive confirmation does not name what gets deleted.",
    suggestion: "Replace 'Are you sure?' with 'Delete the workspace?'.",
    severity: "high",
    confidence: 0.92,
    standard_id: "CLR-01",
    rule: "Use plain language. Don't use jargon.",
    source: "llm",
    related_standards: ["PRF-11"],
    ambiguity_flag: null,
    rule_version: "1.0.0",
    validate_rejection_reason: null,
  };
}

function makeSubstrateResult(
  violation = makeSubstrateViolation(),
): Record<string, unknown> {
  return {
    content_type: "error",
    overall_verdict: "fail",
    verdict: "violation",
    review_reason: null,
    violations: [violation],
    passes: [{ standard_id: "ACT-01", rule: "Use specific verbs." }],
    summary: "Engine summary that should NOT leak.",
    audience: "product_ui",
    moment: "destructive_action",
    pipeline: { standards_checked: 12, standards_total: 47 },
    rationale_chain: [{ step: "classify", inputs: {}, output: {} }],
  };
}

describe("publicViolation", () => {
  const original = process.env;
  beforeEach(() => {
    process.env = { ...original };
  });
  afterEach(() => {
    process.env = original;
  });

  it("returns only public fields by default", () => {
    delete process.env.PUBLIC_TAXONOMY;
    const v = publicViolation(makeSubstrateViolation());
    expect(Object.keys(v).sort()).toEqual([...PUBLIC_VIOLATION_FIELDS].sort());
    for (const forbidden of SUBSTRATE_VIOLATION_FIELDS) {
      expect(v).not.toHaveProperty(forbidden);
    }
  });

  it("includes substrate fields when PUBLIC_TAXONOMY=true", () => {
    process.env.PUBLIC_TAXONOMY = "true";
    const v = publicViolation(makeSubstrateViolation());
    for (const required of SUBSTRATE_VIOLATION_FIELDS) {
      expect(v).toHaveProperty(required);
    }
    for (const required of PUBLIC_VIOLATION_FIELDS) {
      expect(v).toHaveProperty(required);
    }
  });

  it("never emits docs_url (removed in 2.0.0)", () => {
    process.env.PUBLIC_TAXONOMY = "true";
    const v = publicViolation({
      ...makeSubstrateViolation(),
      docs_url: "https://docs.contentrx.io/model/standards/CLR-01",
    });
    expect(v).not.toHaveProperty("docs_url");
  });

  it("defaults severity to medium when missing", () => {
    delete process.env.PUBLIC_TAXONOMY;
    const v = publicViolation({
      issue: "x",
      suggestion: "y",
      confidence: 0.5,
    });
    expect(v.severity).toBe("medium");
  });
});

describe("publicCheckEnvelope", () => {
  const original = process.env;
  beforeEach(() => {
    process.env = { ...original };
  });
  afterEach(() => {
    process.env = original;
  });

  it("emits schema 3.0.0 top-level shape", () => {
    delete process.env.PUBLIC_TAXONOMY;
    const env = publicCheckEnvelope(makeSubstrateResult());
    expect(Object.keys(env).sort()).toEqual([
      "content_type",
      "moment",
      "review_reason",
      "schema_version",
      "suggested_diagnostic",
      // The holistic rewrite that fires for large inputs (>200 chars).
      "suggested_rewrite",
      "verdict",
      "violations",
      "warnings",
    ]);
    expect(env.schema_version).toBe("3.0.0");
    // Default to null when caller didn't provide a rewrite/diagnostic.
    expect(env.suggested_rewrite).toBeNull();
    expect(env.suggested_diagnostic).toBeNull();
  });

  it("forwards content_type and moment from the substrate result", () => {
    delete process.env.PUBLIC_TAXONOMY;
    const env = publicCheckEnvelope(makeSubstrateResult());
    expect(env.content_type).toBe("error");
    expect(env.moment).toBe("destructive_action");
  });

  it("nullifies content_type and moment when missing or empty", () => {
    delete process.env.PUBLIC_TAXONOMY;
    const env = publicCheckEnvelope({
      verdict: "pass",
      violations: [],
      content_type: "",
      moment: null,
    });
    expect(env.content_type).toBeNull();
    expect(env.moment).toBeNull();
  });

  it("strips substrate top-level fields", () => {
    delete process.env.PUBLIC_TAXONOMY;
    const env = publicCheckEnvelope(makeSubstrateResult());
    for (const forbidden of SUBSTRATE_TOP_LEVEL_FIELDS) {
      expect(env).not.toHaveProperty(forbidden);
    }
  });

  it("strips substrate violation fields by default", () => {
    delete process.env.PUBLIC_TAXONOMY;
    const env = publicCheckEnvelope(makeSubstrateResult());
    expect(env.violations).toHaveLength(1);
    const v = env.violations[0];
    expect(Object.keys(v).sort()).toEqual([...PUBLIC_VIOLATION_FIELDS].sort());
  });

  it("surfaces substrate violation fields when PUBLIC_TAXONOMY=true", () => {
    process.env.PUBLIC_TAXONOMY = "true";
    const env = publicCheckEnvelope(makeSubstrateResult());
    const v = env.violations[0];
    for (const required of SUBSTRATE_VIOLATION_FIELDS) {
      expect(v).toHaveProperty(required);
    }
  });

  it("warnings default to empty array", () => {
    delete process.env.PUBLIC_TAXONOMY;
    const env = publicCheckEnvelope(makeSubstrateResult());
    expect(env.warnings).toEqual([]);
  });

  it("warnings propagate when provided", () => {
    delete process.env.PUBLIC_TAXONOMY;
    const env = publicCheckEnvelope(makeSubstrateResult(), {
      warnings: ["upstream model fell back"],
    });
    expect(env.warnings).toEqual(["upstream model fell back"]);
  });

  it("handles empty violations array", () => {
    delete process.env.PUBLIC_TAXONOMY;
    const env = publicCheckEnvelope({ verdict: "pass", violations: [] });
    expect(env.violations).toEqual([]);
    expect(env.verdict).toBe("pass");
    expect(env.review_reason).toBeNull();
  });

  it("preserves verdict and review_reason from substrate", () => {
    delete process.env.PUBLIC_TAXONOMY;
    const env = publicCheckEnvelope({
      verdict: "review_recommended",
      review_reason: "low_confidence",
      violations: [],
    });
    expect(env.verdict).toBe("review_recommended");
    expect(env.review_reason).toBe("low_confidence");
  });

  // -----------------------------------------------------------------
  // Privacy contract snapshot — ADR 2026-04-25.
  //
  // Pins the EXACT shape that ships to user-facing surfaces. Any
  // future refactor that accidentally surfaces a substrate field
  // (`standard_id`, `rule_version`, `rationale_chain`, `passes`,
  // etc.) will diff loudly here instead of slipping past triage.
  // The audit (2026-04-27) called this out as missing — this is
  // the test it was asking for.
  //
  // Inline snapshot keeps the expected shape co-located with the
  // assertion so reviewers don't have to chase a separate __snapshots__
  // file when the contract intentionally changes.
  // -----------------------------------------------------------------
  it("privacy snapshot — kitchen-sink substrate violation produces clean public envelope", () => {
    delete process.env.PUBLIC_TAXONOMY;
    const env = publicCheckEnvelope(makeSubstrateResult());
    // Stable serialization for the snapshot — no Date / undefined
    // surprises across runs.
    expect(JSON.stringify(env, null, 2)).toMatchInlineSnapshot(`
      "{
        "schema_version": "3.0.0",
        "violations": [
          {
            "issue": "This destructive confirmation does not name what gets deleted.",
            "suggestion": "Replace 'Are you sure?' with 'Delete the workspace?'.",
            "severity": "high",
            "confidence": 0.92,
            "category": "Big picture"
          }
        ],
        "verdict": "violation",
        "review_reason": null,
        "warnings": [],
        "content_type": "error",
        "moment": "destructive_action",
        "suggested_rewrite": null,
        "suggested_diagnostic": null
      }"
    `);
  });

  it("privacy snapshot — every substrate field name is absent from default envelope JSON", () => {
    // Belt-and-suspenders: even if the snapshot above stops being
    // run (skipped, deleted), this string-search asserts that the
    // serialized envelope contains zero substrate field names. Any
    // future field added to SUBSTRATE_VIOLATION_FIELDS or
    // SUBSTRATE_TOP_LEVEL_FIELDS gets covered automatically.
    delete process.env.PUBLIC_TAXONOMY;
    const env = publicCheckEnvelope(makeSubstrateResult());
    const serialized = JSON.stringify(env);
    for (const forbidden of SUBSTRATE_VIOLATION_FIELDS) {
      expect(serialized).not.toContain(`"${forbidden}"`);
    }
    for (const forbidden of SUBSTRATE_TOP_LEVEL_FIELDS) {
      expect(serialized).not.toContain(`"${forbidden}"`);
    }
    // Specific high-risk values from the kitchen-sink violation that
    // would identify the private taxonomy if leaked.
    expect(serialized).not.toContain("CLR-01");
    expect(serialized).not.toContain("PRF-11");
    expect(serialized).not.toContain("rationale_chain");
  });
});
