/**
 * HeroVerdictMock — a stylized triple-stack of mock findings shown
 * to the right of the landing hero headline.
 *
 * Composition only. Uses the existing <Pill> primitive and design
 * tokens — no new color decisions, no new geometry. The whole thing
 * is decorative; aria-hidden so screen readers skip past it (the
 * headline + subhead carry the meaning).
 *
 * Why this exists: the landing's hero was previously text-only,
 * which read as "policy page" not "product page." A layered visual
 * composition gives the eye a focal point and demonstrates the
 * shape of an actual ContentRX result before any copy is read.
 *
 * The three findings are illustrative. They show the public envelope
 * shape (issue + suggestion + severity_label) applied to prose that
 * lives in a codebase: a README line, a PR description, an error
 * string in source. Substrate-clean by construction (no standard_id,
 * no rule, no rationale_chain).
 *
 * The stack uses small CSS rotations + offsets for the layered look.
 * No animation here — the wordmark animation is the kinetic moment;
 * this stack is the stillness it lands into.
 */

import { Pill } from "@/components/ui/pill";

type MockFinding = {
  /** Customer-facing severity label, e.g. "Worth adjusting" or "Quick polish". */
  severity: "high" | "medium" | "low";
  severityLabel: string;
  /** Source attribution: "AI" for LLM-emitted findings, "Instant" for
   * preprocessor-emitted findings. Mirrors the finding-card UI. */
  sourceLabel: "AI" | "Instant";
  /** The string the customer wrote (input). */
  inputText: string;
  /** Public envelope `issue` field — what's wrong. */
  issue: string;
  /** Public envelope `suggestion` field — the proposed alternative. */
  suggestion: string;
  /** Customer-facing category label. */
  category: string;
};

// Three artifact types, all unmistakably prose that lives in a
// codebase: a README line, a PR description, and an error string in
// source. Role-agnostic by design (no personas named) and on-thesis:
// the README card's suggestion restates the product's own positioning
// in the house voice, demonstrating the product on the product. The
// front-most card (index 2, opacity 1) is the error string because it
// is the highest-stakes, most visceral "before anyone else sees it"
// case. inputText carries the codebase signal directly (literal code,
// markdown, PR copy) since the type has no file-path field and the
// category slot is force-uppercased.
const FINDINGS: readonly MockFinding[] = [
  {
    severity: "low",
    severityLabel: "Quick polish",
    sourceLabel: "AI",
    inputText:
      "ContentRX is a revolutionary, best-in-class platform that leverages AI to supercharge your workflow.",
    issue: "A developer still can't tell what ContentRX does or who it's for.",
    suggestion:
      "ContentRX reviews the prose in your codebase and flags what to fix before merge.",
    category: "README",
  },
  {
    severity: "medium",
    severityLabel: "Worth adjusting",
    sourceLabel: "AI",
    inputText: "## Summary: fixed some stuff with the auth flow",
    issue: "A reviewer cannot tell what changed or why it is safe to merge.",
    suggestion:
      "Summary: shorten session expiry to 30m and add a refresh-token guard. No API changes.",
    category: "PR description",
  },
  {
    severity: "high",
    severityLabel: "Worth adjusting",
    sourceLabel: "Instant",
    inputText: 'throw new Error("Something went wrong. Try again later.");',
    issue: "The reader can't tell what broke or what to do next.",
    suggestion:
      "We couldn't save your changes. Check your connection and retry.",
    category: "Error message",
  },
] as const;

export function HeroVerdictMock() {
  return (
    <div
      aria-hidden
      className="relative mx-auto w-full max-w-md select-none"
    >
      {/* Stack uses absolute positioning for layered cards. The base
          card sits at the bottom-right with a slight clockwise rotation;
          each card up the stack rotates a touch counter-clockwise so the
          fan reads as "three findings on one screen." */}
      <div className="relative h-[420px] sm:h-[460px]">
        {FINDINGS.map((f, i) => {
          // i=0 is the back-most card; the most-prominent is at the top.
          const offsets = [
            { rotate: 5, x: 24, y: 56, opacity: 0.55 },
            { rotate: -3, x: -14, y: 28, opacity: 0.8 },
            { rotate: 2, x: 8, y: 0, opacity: 1 },
          ] as const;
          const o = offsets[i];
          return (
            <div
              key={i}
              className="absolute inset-x-0 mx-auto"
              style={{
                transform: `translate(${o.x}px, ${o.y}px) rotate(${o.rotate}deg)`,
                opacity: o.opacity,
                zIndex: i,
              }}
            >
              <FindingCard finding={f} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FindingCard({ finding }: { finding: MockFinding }) {
  const tone =
    finding.severity === "high"
      ? "amber"
      : finding.severity === "medium"
        ? "amber"
        : "stone";
  return (
    <div className="rounded-xl border border-line bg-raised p-5 shadow-lg shadow-canvas/40 ring-1 ring-line/40">
      <div className="flex items-center gap-2">
        <Pill tone={tone} size="xs">
          {finding.severityLabel}
        </Pill>
        <span className="text-[10px] font-medium uppercase tracking-wider text-quiet">
          {finding.sourceLabel === "AI" ? "✦ AI" : "⚡ Instant"}
        </span>
        <span className="ml-auto text-[10px] font-medium uppercase tracking-wider text-quiet">
          {finding.category}
        </span>
      </div>
      <p className="mt-3 font-mono text-xs leading-relaxed text-quiet">
        “{finding.inputText}”
      </p>
      <p className="mt-3 text-sm font-medium text-strong">
        {finding.issue}
      </p>
      <div className="mt-3 rounded-md bg-sunken p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-quiet">
          Suggested
        </p>
        <p className="mt-1 text-sm text-default">{finding.suggestion}</p>
      </div>
    </div>
  );
}
