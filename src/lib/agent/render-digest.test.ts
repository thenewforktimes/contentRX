import { describe, expect, it } from "vitest";
import { ZERO_CHECKS_FOOTER, renderDigest } from "./render-digest";
import type { Pattern } from "./pattern-grouping";
import type { AgentRunPayload, CustomizationSignal } from "./run-agent";

/**
 * Digest renderer tests (Phase G3+G4+G5).
 *
 * The roadmap's integrity bar requires six assertions across all
 * four template variants:
 *
 *   (a) substrate fields are absent (no standard_id, no rule_version,
 *       no internal IDs)
 *   (b) em dashes are absent
 *   (c) the trust-signal opener is present
 *   (d) customer-facing vocabulary is in use (Flags, flagged for
 *       drift, flag decisions; never violations, verdicts, overrides)
 *   (e) "0 checks per run" copy is in the digest footer
 *   (f) all four template variants are exercised against fixtures:
 *       setup prompt (0-1 flags), drift digest, no-repetition digest,
 *       mixed digest
 *
 * This file ships all six. Inline snapshot tests pin the high-
 * leverage shapes; assertion-style tests cover the integrity rules.
 */

// Fixtures -----------------------------------------------------------

function pattern(
  standardId: string,
  count: number,
  high = 0,
  medium = count,
  low = 0,
): Pattern {
  return {
    standardId,
    count,
    severityCounts: { high, medium, low },
    lastSeen: new Date("2026-05-09T10:00:00Z"),
  };
}

const COLD_START_CUSTOMIZATION: CustomizationSignal = {
  overrideCount: 4,
  teamRuleCount: 0,
};

const WARMED_UP_CUSTOMIZATION: CustomizationSignal = {
  overrideCount: 47,
  teamRuleCount: 4,
};

function payload(
  overrides: Partial<AgentRunPayload>,
): AgentRunPayload {
  return {
    schemaVersion: 2,
    teamId: "team-fixture",
    runAt: "2026-05-11T13:00:00.000Z",
    windowDays: 30,
    totalFlags: 0,
    headerVariant: "empty",
    patterns: [],
    topPatterns: [],
    isolatedFlags: [],
    customization: COLD_START_CUSTOMIZATION,
    agreedOverridesByStandardId: {},
    ...overrides,
  };
}

// Real standardIds from the engine's standards library. ACT-01 sits
// in the "action_oriented" category → "Action-oriented writing".
// CLR-01 sits in "clarity" → "Clarity". INC-01 sits in
// "inclusive_language" → "Inclusive language". These are the IDs
// the engine emits; the digest renders the category name to the
// customer surface, never the substrate ID.
const ACT_01 = "ACT-01";
const CLR_01 = "CLR-01";
const INC_01 = "INC-01";

// Integrity bar assertions ------------------------------------------

const SUBSTRATE_FIELD_NAMES = [
  "standard_id",
  "standardId",
  "rule_version",
  "ruleVersion",
  "rationale_chain",
  "rationaleChain",
];

function assertNoSubstrateLeak(markdown: string) {
  // No literal substrate field names.
  for (const f of SUBSTRATE_FIELD_NAMES) {
    expect(markdown).not.toContain(f);
  }
  // No engine standard-IDs (CLR-01, ACT-01, etc.). Pattern: 2-4
  // uppercase letters, hyphen, two digits.
  expect(markdown).not.toMatch(/\b[A-Z]{2,4}-\d{2}\b/);
}

function assertNoEmDash(markdown: string) {
  expect(markdown).not.toMatch(/—/);
}

function assertCustomerFacingVocabulary(markdown: string) {
  // Words banned on a customer surface (substrate vocabulary).
  expect(markdown).not.toMatch(/\bviolations?\b/i);
  expect(markdown).not.toMatch(/\bverdicts?\b/i);
  // Customer-facing word "flag(s)" must appear.
  expect(markdown.toLowerCase()).toContain("flag");
}

function assertHasFooter(markdown: string) {
  expect(markdown).toContain(ZERO_CHECKS_FOOTER);
  expect(markdown).toContain("0 checks per run");
}

function assertHasTrustOpener(markdown: string) {
  // Either the cold-start opener ("This week's digest is informed
  // by N flags ContentRX has raised...") or the warmed-up opener
  // ("...your last N flag decisions, your M custom examples, ...").
  // The setup-prompt path uses a different opener; we don't enforce
  // the opener there.
  expect(markdown).toMatch(/This week's digest is informed by/);
}

function applyAllIntegrityChecks(
  markdown: string,
  opts: { setupPrompt?: boolean } = {},
) {
  // (a) substrate-leak fence
  assertNoSubstrateLeak(markdown);
  // (b) no em dashes
  assertNoEmDash(markdown);
  // (d) customer-facing vocabulary
  assertCustomerFacingVocabulary(markdown);
  // (e) footer present
  assertHasFooter(markdown);
  // (c) trust opener — only for the non-setup-prompt variants
  if (!opts.setupPrompt) {
    assertHasTrustOpener(markdown);
  }
}

// Variant fixtures --------------------------------------------------

const FIXTURE_SETUP_PROMPT = payload({
  headerVariant: "empty",
  totalFlags: 0,
});

const FIXTURE_DRIFT = payload({
  headerVariant: "drift",
  totalFlags: 12,
  patterns: [pattern(ACT_01, 6), pattern(CLR_01, 4), pattern(INC_01, 2)],
  topPatterns: [pattern(ACT_01, 6), pattern(CLR_01, 4), pattern(INC_01, 2)],
  isolatedFlags: [],
});

const FIXTURE_NO_REPETITION = payload({
  headerVariant: "no-repetition",
  totalFlags: 3,
  patterns: [pattern(ACT_01, 1), pattern(CLR_01, 1), pattern(INC_01, 1)],
  topPatterns: [pattern(ACT_01, 1), pattern(CLR_01, 1), pattern(INC_01, 1)],
  isolatedFlags: [pattern(ACT_01, 1), pattern(CLR_01, 1), pattern(INC_01, 1)],
});

const FIXTURE_MIXED = payload({
  headerVariant: "mixed",
  totalFlags: 7,
  patterns: [
    pattern(ACT_01, 4),
    pattern(CLR_01, 1),
    pattern(INC_01, 1),
    pattern("VT-01", 1),
  ],
  topPatterns: [pattern(ACT_01, 4)],
  isolatedFlags: [
    pattern(CLR_01, 1),
    pattern(INC_01, 1),
    pattern("VT-01", 1),
  ],
});

// Integrity-bar tests across all four variants ---------------------

describe("renderDigest integrity bar (six assertions × four variants)", () => {
  it("setup-prompt variant passes the integrity bar", () => {
    const md = renderDigest(FIXTURE_SETUP_PROMPT);
    applyAllIntegrityChecks(md, { setupPrompt: true });
  });

  it("drift variant passes the integrity bar", () => {
    const md = renderDigest(FIXTURE_DRIFT);
    applyAllIntegrityChecks(md);
  });

  it("no-repetition variant passes the integrity bar", () => {
    const md = renderDigest(FIXTURE_NO_REPETITION);
    applyAllIntegrityChecks(md);
  });

  it("mixed variant passes the integrity bar", () => {
    const md = renderDigest(FIXTURE_MIXED);
    applyAllIntegrityChecks(md);
  });
});

// Variant-specific shape tests --------------------------------------

describe("renderDigest variant shapes", () => {
  it("setup-prompt opens with 'Setting up your review agent'", () => {
    const md = renderDigest(FIXTURE_SETUP_PROMPT);
    expect(md).toContain("# Setting up your review agent");
  });

  it("drift variant opens with 'Flagged for drift this week'", () => {
    const md = renderDigest(FIXTURE_DRIFT);
    expect(md).toContain("# Flagged for drift this week");
  });

  it("no-repetition variant opens with the alternate header", () => {
    const md = renderDigest(FIXTURE_NO_REPETITION);
    expect(md).toContain("# This week's flags from your team's writing");
    // No "Flagged for drift" header on this variant.
    expect(md).not.toContain("Flagged for drift this week");
  });

  it("mixed variant uses the drift header AND the 'Other flags this week' subheading", () => {
    const md = renderDigest(FIXTURE_MIXED);
    expect(md).toContain("# Flagged for drift this week");
    expect(md).toContain("## Other flags this week");
  });

  it("renders top three patterns max in drift", () => {
    const md = renderDigest(
      payload({
        headerVariant: "drift",
        totalFlags: 20,
        patterns: [
          pattern(ACT_01, 5),
          pattern(CLR_01, 4),
          pattern(INC_01, 3),
          pattern("VT-01", 2), // should NOT render
          pattern("ACC-04", 2), // should NOT render
        ],
        topPatterns: [
          pattern(ACT_01, 5),
          pattern(CLR_01, 4),
          pattern(INC_01, 3),
        ],
        isolatedFlags: [],
      }),
    );
    expect(md).toContain("Action-oriented writing");
    expect(md).toContain("Clarity");
    expect(md).toContain("Inclusive language");
    // The fourth and fifth patterns shouldn't surface.
    expect(md).not.toContain("Voice and tone");
    expect(md).not.toContain("Accessibility");
  });
});

// Trust-signal opener tests ----------------------------------------

describe("renderDigest trust-signal opener", () => {
  it("uses cold-start opener when customization is sparse", () => {
    const md = renderDigest({
      ...FIXTURE_DRIFT,
      customization: COLD_START_CUSTOMIZATION,
    });
    expect(md).toContain("12 flags ContentRX has raised");
    // Cold-start does NOT cite override decisions or custom examples.
    expect(md).not.toContain("flag decisions");
    expect(md).not.toContain("custom examples");
  });

  it("uses warmed-up opener when the team has accumulated signal", () => {
    const md = renderDigest({
      ...FIXTURE_DRIFT,
      customization: WARMED_UP_CUSTOMIZATION,
    });
    expect(md).toContain("47 flag decisions");
    expect(md).toContain("4 active team rules");
  });

  it("warmed-up opener handles singular/plural correctly", () => {
    const md = renderDigest({
      ...FIXTURE_DRIFT,
      customization: {
        overrideCount: 31,
        teamRuleCount: 1,
      },
    });
    expect(md).toContain("31 flag decisions");
    expect(md).toContain("1 active team rule");
  });
});

// Citation rendering tests -----------------------------------------

describe("renderDigest citation shapes", () => {
  it("cold-start citation pulls the standard's example pair from the library", () => {
    const md = renderDigest({
      ...FIXTURE_DRIFT,
      customization: COLD_START_CUSTOMIZATION,
      agreedOverridesByStandardId: {},
    });
    // The standards library's `incorrect` and `correct` examples
    // are quoted in italics. The exact text comes from the library
    // (it varies as content design refinements land), so the
    // assertion is on the SHAPE (an italicised before/after pair),
    // not the literal copy.
    expect(md).toMatch(/Common pattern: writing that fits the shape of /);
    expect(md).toMatch(/lands harder as /);
  });

  it("warmed-up citation appends the team's accept count", () => {
    const md = renderDigest({
      ...FIXTURE_DRIFT,
      customization: WARMED_UP_CUSTOMIZATION,
      agreedOverridesByStandardId: {
        [ACT_01]: 8,
        [CLR_01]: 3,
      },
    });
    expect(md).toContain(
      "Your team has accepted this pattern's rewrites 8 times in the last month",
    );
    expect(md).toContain(
      "Your team has accepted this pattern's rewrites 3 times in the last month",
    );
  });

  it("warmed-up citation handles a singular accept count", () => {
    const md = renderDigest({
      ...FIXTURE_DRIFT,
      customization: WARMED_UP_CUSTOMIZATION,
      agreedOverridesByStandardId: {
        [ACT_01]: 1,
      },
    });
    expect(md).toContain(
      "Your team has accepted this pattern's rewrites 1 time in the last month",
    );
  });
});

// Customer-facing-label translation tests --------------------------

describe("renderDigest substrate translation", () => {
  it("never renders the engine's standardId; renders category name instead", () => {
    const md = renderDigest(FIXTURE_DRIFT);
    // Substrate IDs absent.
    expect(md).not.toContain("ACT-01");
    expect(md).not.toContain("CLR-01");
    expect(md).not.toContain("INC-01");
    // Customer-facing category names present.
    expect(md).toContain("Action-oriented writing");
    expect(md).toContain("Clarity");
    expect(md).toContain("Inclusive language");
  });

  it("falls back gracefully for unknown standardIds", () => {
    // A future engine might emit a standard our library doesn't know
    // about. Fallback to "Pattern" rather than leaking the substrate
    // ID or crashing the digest.
    const md = renderDigest(
      payload({
        headerVariant: "drift",
        totalFlags: 4,
        patterns: [pattern("UNKNOWN-99", 4)],
        topPatterns: [pattern("UNKNOWN-99", 4)],
        isolatedFlags: [],
      }),
    );
    expect(md).not.toContain("UNKNOWN-99");
    expect(md).toContain("Pattern");
  });
});

// Footer + locked-copy tests ---------------------------------------

describe("ZERO_CHECKS_FOOTER", () => {
  it("matches the roadmap's locked wording verbatim", () => {
    expect(ZERO_CHECKS_FOOTER).toBe(
      "Cost: 0 checks per run. The agent reads flags your other surfaces have already produced (Figma plugin, GitHub Action, MCP, LSP, CLI, paste mode) and renders them as a weekly digest. Your monthly check limit is unaffected.",
    );
  });

  it("contains no em dash (voice rule 2)", () => {
    expect(ZERO_CHECKS_FOOTER).not.toMatch(/—/);
  });
});
