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
 * The three findings are illustrative — they show the public
 * envelope shape (issue + suggestion + severity_label) the way it
 * would render in the dashboard's finding cards. Substrate-clean by
 * construction (no standard_id, no rule, no rationale_chain).
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

const FINDINGS: readonly MockFinding[] = [
  {
    severity: "high",
    severityLabel: "Worth adjusting",
    sourceLabel: "AI",
    inputText: "Click here to manage your subscription.",
    issue: "Link text is too vague to convey destination.",
    suggestion: "Manage your subscription",
    category: "Accessibility",
  },
  {
    severity: "medium",
    severityLabel: "Worth adjusting",
    sourceLabel: "AI",
    inputText: "Are you sure you want to delete this?",
    issue: "Empty confirmation prompt — what happens after?",
    suggestion: "Delete this draft? You'll lose the last 12 minutes of edits.",
    category: "Voice & tone",
  },
  {
    severity: "low",
    severityLabel: "Quick polish",
    sourceLabel: "Instant",
    inputText: "Submit",
    issue: "Generic verb on a destructive action.",
    suggestion: "Send invites",
    category: "Action verbs",
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
