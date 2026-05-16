/**
 * Weekly review digest renderer (Phase G3+G4+G5, 2026-05-09 roadmap).
 *
 * Pure function: takes an `AgentRunPayload` and returns markdown
 * suitable for a draft GitHub PR body. Substrate-clean by
 * construction — every customer-visible string is rendered through
 * customer-facing vocabulary (Flags, flagged for drift, flag
 * decisions; never violations, verdicts, overrides). The standards
 * library is consulted ONLY for category-name translation, which is
 * customer-visible per the public envelope; engine substrate IDs
 * (CLR-01, etc.) AND standards exemplar prose (incorrect/correct
 * pairs) never reach the rendered output. (2026-05-16: the cold-start
 * citation no longer quotes library exemplars — the cross-surface
 * no-taxonomy principle; ADR 2026-04-25 addendum.)
 *
 * Locked copy this file owns:
 *   - Footer: "Cost: 0 checks per run. The agent reads flags your
 *     other surfaces have already produced (GitHub Action, MCP,
 *     LSP, CLI, paste mode) and renders them as a weekly digest.
 *     Your monthly check limit is unaffected."
 *     Identical to the dashboard page copy and (eventually) the
 *     install confirmation modal — the three-place rule from the
 *     roadmap.
 *
 * Trust-signal opener: cold-start when the team has fewer than
 * ~30 flag decisions or has been quiet (low overrideCount), warmed-
 * up otherwise. The threshold lives in this file so the citations
 * and opener stay aligned.
 *
 * Header variant: selected by `digestHeaderVariant(violations)` in
 * pattern-grouping.ts. Four variants — drift / no-repetition / mixed
 * / empty (the setup-prompt path).
 *
 * No em dashes. Voice rule 2 of docs/copy-vocabulary.md.
 */

import { CATEGORIES, STANDARDS_BY_ID } from "@/lib/standards";
import type { Pattern } from "./pattern-grouping";
import type { AgentRunPayload, CustomizationSignal } from "./run-agent";

/** Threshold for the warmed-up trust opener. A team is "warmed up"
 * when their accumulated customization signal is meaningful enough
 * that citing it adds trust to the digest. The roadmap uses ~30
 * flag decisions as the cutoff; we approximate by combining the
 * customization counts. */
const WARMED_UP_OVERRIDE_THRESHOLD = 30;

/** The locked footer copy. Per the roadmap's integrity bar, this
 * sentence appears in three places verbatim:
 *   1. The /dashboard/agent page copy
 *   2. The install confirmation modal (G3 follow-up, when the
 *      GitHub App is registered)
 *   3. The PR comment footer (this file)
 */
export const ZERO_CHECKS_FOOTER =
  "Cost: 0 checks per run. The agent reads flags your other surfaces have already produced (GitHub Action, MCP, LSP, CLI, paste mode) and renders them as a weekly digest. Your monthly check limit is unaffected.";

/** Category-name lookup. Names mirror the public taxonomy. */
const CATEGORY_NAMES: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const cat of CATEGORIES) {
    out[cat.id] = cat.name;
  }
  return out;
})();

/** Customer-facing label for a pattern. Translates the engine's
 * standardId to the standard's category name. Falls back to a
 * generic "Pattern" label when the standard isn't in the library
 * (forward-compat with new standards landing between the agent run
 * and the digest render). */
function patternLabel(standardId: string): string {
  const std = STANDARDS_BY_ID[standardId];
  if (!std) return "Pattern";
  return CATEGORY_NAMES[std.category] ?? "Pattern";
}

/** Pluralise "flag" for the citation count. */
function flagCount(n: number): string {
  return n === 1 ? "1 flag" : `${n} flags`;
}

/** Decide the trust-signal opener variant. */
function isWarmedUp(c: CustomizationSignal): boolean {
  // Either flag-decision history or an active team-rule layer lifts
  // the team out of cold-start.
  if (c.overrideCount >= WARMED_UP_OVERRIDE_THRESHOLD) return true;
  if (c.teamRuleCount >= 1) return true;
  return false;
}

/** Trust-signal opener — the first sentence after the header. */
function renderOpener(
  payload: AgentRunPayload,
  customization: CustomizationSignal,
): string {
  if (isWarmedUp(customization)) {
    const parts: string[] = [];
    parts.push(
      `your last ${customization.overrideCount} flag ${customization.overrideCount === 1 ? "decision" : "decisions"}`,
    );
    if (customization.teamRuleCount > 0) {
      parts.push(
        `your ${customization.teamRuleCount} active team ${customization.teamRuleCount === 1 ? "rule" : "rules"}`,
      );
    }
    return `This week's digest is informed by ${joinWithAnd(parts)}.`;
  }
  return `This week's digest is informed by ${flagCount(payload.totalFlags)} ContentRX has raised on your repo this month.`;
}

function joinWithAnd(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/** Render one pattern block: heading + citation. */
function renderPatternBlock(
  pattern: Pattern,
  agreedOverrides: number,
): string {
  const label = patternLabel(pattern.standardId);

  const header = `### ${label} (${flagCount(pattern.count)} this month)`;

  // Cross-surface privacy principle (2026-05-16; ADR 2026-04-25
  // addendum): the agent digest emits the same human-relatable flags
  // as every other check surface and NEVER the taxonomy. This
  // citation previously quoted the standards library's
  // incorrect/correct exemplar prose (patternExamplePair) — that
  // exemplar prose is private substrate. It now stands only on the
  // team's OWN signal: the flag count for this pattern (their
  // content, visible to them in the dashboard) plus, when warmed up,
  // their own accepted-rewrite history appended below.
  const citationLines: string[] = [
    `${flagCount(pattern.count)} fired for this pattern in the last month. Specific strings are visible in the dashboard.`,
  ];

  if (agreedOverrides > 0) {
    citationLines.push(
      `Your team has accepted this pattern's rewrites ${agreedOverrides} ${agreedOverrides === 1 ? "time" : "times"} in the last month; this digest follows the same pattern.`,
    );
  }

  return `${header}\n\n${citationLines.join(" ")}`;
}

/** Render isolated (count=1) flags as a bulleted list. */
function renderIsolatedFlagsBlock(
  isolated: readonly Pattern[],
): string {
  if (isolated.length === 0) return "";
  const items = isolated
    .slice(0, 5) // cap at 5 to keep the digest scannable
    .map((p) => `- **${patternLabel(p.standardId)}** flagged once.`)
    .join("\n");
  return items;
}

/**
 * Render the full digest as markdown. Pure function over the payload
 * + customization. The customization argument shadows
 * payload.customization so callers can override (e.g. for the
 * `/dashboard/agent` "Run preview now" path that wants live counts
 * even when the persisted payload is older).
 */
export function renderDigest(
  payload: AgentRunPayload,
  customization?: CustomizationSignal,
): string {
  const c = customization ?? payload.customization;
  const overridesByStd = payload.agreedOverridesByStandardId ?? {};

  const sections: string[] = [];

  // ---- Setup-prompt variant (0-1 flags). The agent is set up;
  // the team just hasn't accumulated enough flag history yet for
  // a meaningful digest.
  if (payload.headerVariant === "empty") {
    sections.push("# Setting up your review agent");
    sections.push(
      "ContentRX has fewer than two flags on your repo this month, so this week's digest is light. The agent is set up and watching; once your team's writing surfaces a few patterns, the weekly digest will start showing them here.",
    );
    sections.push(
      "In the meantime: [run a check now](https://contentrx.io/dashboard/explain) to seed the first flags, or [install another surface](https://contentrx.io/install) to wire ContentRX into your team's workflow.",
    );
    sections.push("---");
    sections.push(ZERO_CHECKS_FOOTER);
    return sections.join("\n\n");
  }

  // ---- Drift / no-repetition / mixed variants. Header + opener.
  const headerText =
    payload.headerVariant === "no-repetition"
      ? "This week's flags from your team's writing"
      : "Flagged for drift this week";
  sections.push(`# ${headerText}`);
  sections.push(renderOpener(payload, c));

  // ---- Pattern blocks (drift + mixed share this section).
  if (
    payload.headerVariant === "drift" ||
    payload.headerVariant === "mixed"
  ) {
    const patterns = payload.patterns.filter((p) => p.count >= 2).slice(0, 3);
    for (const p of patterns) {
      const agreed = overridesByStd[p.standardId] ?? 0;
      sections.push(renderPatternBlock(p, agreed));
    }
  }

  // ---- Isolated flags (no-repetition + mixed share this section).
  if (
    payload.headerVariant === "no-repetition" ||
    payload.headerVariant === "mixed"
  ) {
    if (payload.headerVariant === "mixed") {
      sections.push("## Other flags this week");
    }
    const block = renderIsolatedFlagsBlock(payload.isolatedFlags);
    if (block) sections.push(block);
  }

  // ---- Footer.
  sections.push("---");
  sections.push(ZERO_CHECKS_FOOTER);

  return sections.join("\n\n");
}
