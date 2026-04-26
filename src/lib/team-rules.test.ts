/**
 * Tests for the pure-logic exports of team-rules.ts.
 *
 * The 4-step team-rule pipeline (disable → override → add → verdict)
 * runs on every /api/check request for Team-plan customers. Audit
 * 2026-04-26 flagged this 334-LOC module as having zero test
 * coverage despite being directly on the hot path. This suite covers
 * the synchronous, pure-logic exports; the two DB-coupled functions
 * (loadTeamRules, nextCustomStandardId) are deferred to PR8 where
 * the integration-mock harness lands.
 */

import { describe, expect, it } from "vitest";
import {
  applyAddedRules,
  applyDisabledFilter,
  applyOverrides,
  findReDoSConcern,
  recomputeVerdict,
  type EvaluationResult,
  type LoadedRules,
  type OverrideFields,
} from "./team-rules";

// ---------------------------------------------------------------------------
// findReDoSConcern
// ---------------------------------------------------------------------------

describe("findReDoSConcern", () => {
  it("accepts a simple literal pattern", () => {
    expect(findReDoSConcern("foo")).toBeNull();
  });

  it("accepts a single anchored quantifier", () => {
    expect(findReDoSConcern("^foo+$")).toBeNull();
    expect(findReDoSConcern("ab*c")).toBeNull();
    expect(findReDoSConcern("\\d{3,5}")).toBeNull();
  });

  it("rejects patterns over 500 chars", () => {
    const huge = "a".repeat(501);
    expect(findReDoSConcern(huge)).toMatch(/too long/i);
  });

  it("flags textbook nested unbounded quantifiers", () => {
    expect(findReDoSConcern("(a+)+")).toMatch(/nested unbounded/i);
    expect(findReDoSConcern("(a*)*")).toMatch(/nested unbounded/i);
    expect(findReDoSConcern("(a+)*")).toMatch(/nested unbounded/i);
    expect(findReDoSConcern("(a*)+")).toMatch(/nested unbounded/i);
  });

  it("flags nested unbounded quantifier with brace repetition", () => {
    expect(findReDoSConcern("(a+){5,}")).toMatch(/nested unbounded/i);
  });

  it("flags stacked greedy wildcards", () => {
    expect(findReDoSConcern(".*.*")).toMatch(/greedy wildcards/i);
    expect(findReDoSConcern(".+.+")).toMatch(/greedy wildcards/i);
    expect(findReDoSConcern(".*.+")).toMatch(/greedy wildcards/i);
    expect(findReDoSConcern(".+.*")).toMatch(/greedy wildcards/i);
  });

  it("does not false-flag a single greedy wildcard", () => {
    expect(findReDoSConcern("foo.*bar")).toBeNull();
    expect(findReDoSConcern(".+")).toBeNull();
  });

  it("does not false-flag plain group + outer quantifier", () => {
    // (foo)+ has no inner unbounded quantifier; only the outer.
    expect(findReDoSConcern("(foo)+")).toBeNull();
    expect(findReDoSConcern("(abc)*")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// applyDisabledFilter
// ---------------------------------------------------------------------------

describe("applyDisabledFilter", () => {
  const baseResult: EvaluationResult = {
    violations: [
      { standard_id: "GRM-01", issue: "oxford comma" },
      { standard_id: "PRF-04", issue: "straight quotes" },
      { standard_id: "ACC-01", issue: "vague link" },
    ],
    overall_verdict: "fail",
  };

  it("returns the input unchanged when the disabled set is empty", () => {
    const out = applyDisabledFilter(baseResult, new Set<string>());
    expect(out).toBe(baseResult);
  });

  it("removes only violations whose standard_id is disabled", () => {
    const out = applyDisabledFilter(baseResult, new Set(["GRM-01"]));
    expect(out.violations).toHaveLength(2);
    expect(out.violations!.map((v) => v.standard_id)).toEqual([
      "PRF-04",
      "ACC-01",
    ]);
  });

  it("removes multiple disabled violations in one pass", () => {
    const out = applyDisabledFilter(
      baseResult,
      new Set(["GRM-01", "PRF-04"]),
    );
    expect(out.violations!.map((v) => v.standard_id)).toEqual(["ACC-01"]);
  });

  it("keeps violations without a standard_id (defensive)", () => {
    const result: EvaluationResult = {
      violations: [
        { standard_id: "GRM-01", issue: "oxford" },
        { issue: "no id at all" },
      ],
    };
    const out = applyDisabledFilter(result, new Set(["GRM-01"]));
    expect(out.violations).toHaveLength(1);
    expect(out.violations![0]?.issue).toBe("no id at all");
  });

  it("does not mutate the input result", () => {
    const before = JSON.stringify(baseResult);
    applyDisabledFilter(baseResult, new Set(["GRM-01"]));
    expect(JSON.stringify(baseResult)).toBe(before);
  });

  it("handles missing violations array", () => {
    const result: EvaluationResult = { overall_verdict: "pass" };
    const out = applyDisabledFilter(result, new Set(["GRM-01"]));
    expect(out.violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// applyOverrides
// ---------------------------------------------------------------------------

describe("applyOverrides", () => {
  const baseResult: EvaluationResult = {
    violations: [
      {
        standard_id: "GRM-01",
        rule: "Oxford comma",
        severity: "low",
        issue: "missing oxford",
      },
      {
        standard_id: "PRF-04",
        rule: "Straight quotes",
        severity: "medium",
      },
    ],
  };

  it("returns the input unchanged when there are no overrides", () => {
    const out = applyOverrides(baseResult, new Map());
    expect(out).toBe(baseResult);
  });

  it("rewrites rule + severity + title only on matched standard_id", () => {
    const overrides = new Map<string, OverrideFields>([
      [
        "GRM-01",
        {
          rule: "Oxford comma per house style",
          severity: "high",
          title: "House comma rule",
        },
      ],
    ]);
    const out = applyOverrides(baseResult, overrides);
    expect(out.violations![0]).toMatchObject({
      standard_id: "GRM-01",
      rule: "Oxford comma per house style",
      severity: "high",
      title: "House comma rule",
      issue: "missing oxford", // untouched
    });
    expect(out.violations![1]).toMatchObject({
      standard_id: "PRF-04",
      rule: "Straight quotes",
      severity: "medium",
    });
  });

  it("only rewrites fields present in the patch", () => {
    const overrides = new Map<string, OverrideFields>([
      ["GRM-01", { rule: "New rule" }],
    ]);
    const out = applyOverrides(baseResult, overrides);
    expect(out.violations![0]?.rule).toBe("New rule");
    expect(out.violations![0]?.severity).toBe("low"); // not overwritten
  });

  it("ignores violations without a standard_id", () => {
    const result: EvaluationResult = {
      violations: [{ issue: "no id" }],
    };
    const overrides = new Map<string, OverrideFields>([
      ["GRM-01", { rule: "X" }],
    ]);
    const out = applyOverrides(result, overrides);
    expect(out.violations![0]).toEqual({ issue: "no id" });
  });

  it("does not mutate the input violations", () => {
    const result: EvaluationResult = {
      violations: [{ standard_id: "GRM-01", rule: "original" }],
    };
    const overrides = new Map<string, OverrideFields>([
      ["GRM-01", { rule: "patched" }],
    ]);
    applyOverrides(result, overrides);
    expect(result.violations![0]?.rule).toBe("original");
  });
});

// ---------------------------------------------------------------------------
// applyAddedRules
// ---------------------------------------------------------------------------

describe("applyAddedRules", () => {
  const baseResult: EvaluationResult = {
    violations: [{ standard_id: "GRM-01", issue: "oxford" }],
  };

  function addRule(
    standardId: string,
    pattern: string,
    extras?: Partial<LoadedRules["adds"][number]["fields"]>,
  ): LoadedRules["adds"][number] {
    return {
      standardId,
      fields: {
        title: "Custom rule",
        rule: "Don't say {match}",
        severity: "medium",
        pattern,
        ...extras,
      },
    };
  }

  it("returns the input unchanged when no rules are added", () => {
    const out = applyAddedRules(baseResult, "irrelevant text", []);
    expect(out).toBe(baseResult);
  });

  it("appends a violation when a custom rule matches", () => {
    const out = applyAddedRules(baseResult, "this contains forbidden text", [
      addRule("TEAM-01", "forbidden"),
    ]);
    expect(out.violations).toHaveLength(2);
    expect(out.violations![1]).toMatchObject({
      standard_id: "TEAM-01",
      title: "Custom rule",
      severity: "medium",
      source: "team-rule",
    });
    expect(out.violations![1]?.issue).toContain("forbidden");
  });

  it("does not append when no rule matches", () => {
    const out = applyAddedRules(baseResult, "clean text here", [
      addRule("TEAM-01", "forbidden"),
    ]);
    expect(out.violations).toHaveLength(1);
    expect(out.violations![0]?.standard_id).toBe("GRM-01");
  });

  it("respects case-insensitive flag", () => {
    const sensitive = applyAddedRules(baseResult, "FORBIDDEN", [
      addRule("TEAM-01", "forbidden"),
    ]);
    expect(sensitive.violations).toHaveLength(1); // no match — only base

    const insensitive = applyAddedRules(baseResult, "FORBIDDEN", [
      addRule("TEAM-01", "forbidden", { case_insensitive: true }),
    ]);
    expect(insensitive.violations).toHaveLength(2);
  });

  it("clips text to CUSTOM_RULE_MAX_TEXT_BYTES before pattern matching", () => {
    // Build text where the match is ONLY past the 10KB limit. The
    // clipped slice must not contain the matching substring.
    const filler = "a".repeat(10_500);
    const text = filler + "needle";
    const out = applyAddedRules(baseResult, text, [
      addRule("TEAM-01", "needle"),
    ]);
    expect(out.violations).toHaveLength(1); // base only — no append
  });

  it("appends multiple violations when multiple rules match", () => {
    const out = applyAddedRules(baseResult, "alpha and bravo", [
      addRule("TEAM-01", "alpha"),
      addRule("TEAM-02", "bravo"),
    ]);
    expect(out.violations).toHaveLength(3);
    expect(
      out.violations!
        .filter((v) => v.standard_id?.startsWith("TEAM-"))
        .map((v) => v.standard_id),
    ).toEqual(["TEAM-01", "TEAM-02"]);
  });

  it("ignores invalid regex patterns rather than crashing", () => {
    // Unbalanced paren — RegExp throws SyntaxError. Pipeline must
    // skip the rule and return the base result intact.
    const out = applyAddedRules(baseResult, "any text", [
      addRule("TEAM-01", "(unclosed"),
    ]);
    expect(out.violations).toHaveLength(1);
    expect(out.violations![0]?.standard_id).toBe("GRM-01");
  });
});

// ---------------------------------------------------------------------------
// recomputeVerdict
// ---------------------------------------------------------------------------

describe("recomputeVerdict", () => {
  it("emits 'pass' when violations is empty", () => {
    const out = recomputeVerdict({ violations: [] });
    expect(out.overall_verdict).toBe("pass");
  });

  it("emits 'pass' when violations is missing", () => {
    const out = recomputeVerdict({});
    expect(out.overall_verdict).toBe("pass");
  });

  it("emits 'fail' when violations is non-empty", () => {
    const out = recomputeVerdict({
      violations: [{ standard_id: "GRM-01" }],
    });
    expect(out.overall_verdict).toBe("fail");
  });

  it("preserves other fields on the result", () => {
    const out = recomputeVerdict({
      violations: [],
      passes: [{ standard_id: "GRM-01" }],
      schema_version: "2.0.0",
    });
    expect(out.passes).toEqual([{ standard_id: "GRM-01" }]);
    expect(out.schema_version).toBe("2.0.0");
  });

  it("overrides a stale overall_verdict on the input", () => {
    // Caller may pass through a stale "fail" — recomputeVerdict
    // exists precisely so the post-disable/override/add pipeline
    // emits the truth, not whatever the engine emitted upstream.
    const out = recomputeVerdict({
      violations: [],
      overall_verdict: "fail",
    });
    expect(out.overall_verdict).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// Pipeline integration — disable → override → add → verdict
// ---------------------------------------------------------------------------

describe("team-rules pipeline integration", () => {
  it("matches the order /api/check applies them: disable → override → add → verdict", () => {
    const original: EvaluationResult = {
      violations: [
        { standard_id: "GRM-01", rule: "Oxford comma", severity: "low" },
        { standard_id: "PRF-04", rule: "Straight quotes", severity: "medium" },
      ],
      overall_verdict: "fail",
    };

    const disabled = new Set(["PRF-04"]);
    const overrides = new Map<string, OverrideFields>([
      ["GRM-01", { rule: "Oxford comma per house style", severity: "high" }],
    ]);
    const adds: LoadedRules["adds"] = [
      {
        standardId: "TEAM-01",
        fields: {
          title: "No 'utilize'",
          rule: "Use 'use' instead of 'utilize'.",
          severity: "low",
          pattern: "utilize",
          case_insensitive: true,
        },
      },
    ];
    const text = "We utilize this hard, oxford-style.";

    const stage1 = applyDisabledFilter(original, disabled);
    const stage2 = applyOverrides(stage1, overrides);
    const stage3 = applyAddedRules(stage2, text, adds);
    const final = recomputeVerdict(stage3);

    expect(final.violations).toHaveLength(2);
    expect(final.violations!.map((v) => v.standard_id)).toEqual([
      "GRM-01",
      "TEAM-01",
    ]);
    expect(final.violations![0]?.rule).toBe("Oxford comma per house style");
    expect(final.violations![0]?.severity).toBe("high");
    expect(final.violations![1]?.source).toBe("team-rule");
    expect(final.overall_verdict).toBe("fail");
  });

  it("recomputes 'pass' when all violations were disabled", () => {
    const original: EvaluationResult = {
      violations: [{ standard_id: "GRM-01" }, { standard_id: "PRF-04" }],
      overall_verdict: "fail",
    };
    const disabled = new Set(["GRM-01", "PRF-04"]);

    const stage1 = applyDisabledFilter(original, disabled);
    const stage2 = applyOverrides(stage1, new Map());
    const stage3 = applyAddedRules(stage2, "clean text", []);
    const final = recomputeVerdict(stage3);

    expect(final.violations).toEqual([]);
    expect(final.overall_verdict).toBe("pass");
  });
});
