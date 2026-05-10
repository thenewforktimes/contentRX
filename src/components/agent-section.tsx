/**
 * AgentSection — quadrant-cell version of the weekly review agent.
 *
 * 2026-05-10 lower-fold rebuild. The prior pass shipped this as a
 * full-width panel with a 2-column layout (sub-claim cards + digest
 * mock). Robo's review on the rebuild flagged the lower fold as
 * shabby compared to the upper sections; the agent panel was the
 * one good visual but the surrounding sections were text-only.
 *
 * Solution: convert the lower fold to a 2x2 product-quadrant rhythm
 * (Apple homepage pattern). Agent becomes one of two cells in the
 * second 2-up row, alongside One approval. The 3 sub-claim cards
 * are dropped; the simplified digest mock + headline + 1-line body
 * + CTA carries the cell.
 *
 * Pinned copy (the page test asserts on these strings):
 *   - "Weekly review agent" (eyebrow)
 *   - "Drift, caught every Monday." (heading)
 *   - "Team plan" (pricing read; phrasing relaxed via regex)
 *   - href="/dashboard/agent" (preview link)
 *
 * The mock is the load-bearing visual. Stylized, decorative,
 * aria-hidden. Trimmed for cell-fit: Pull-request header chip,
 * digest title, three pattern bullets with Pill tags, footer line.
 */

import Link from "next/link";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";

export function AgentSection() {
  return (
    <li
      id="agent"
      className="flex flex-col rounded-2xl border border-line bg-raised p-6 sm:p-8"
    >
      <Eyebrow>Weekly review agent</Eyebrow>
      <p className="mt-3 text-lg font-semibold text-strong sm:text-xl">
        Drift, caught every Monday.
      </p>
      <p className="mt-2 text-sm text-default">
        A weekly digest. Zero LLM calls. On the Team plan.
      </p>
      <div className="flex flex-1 items-center justify-center py-6">
        <DigestMock />
      </div>
      <Link
        href="/dashboard/agent"
        className="inline-flex w-fit items-center gap-1 text-sm font-medium text-default underline underline-offset-2 hover:text-strong"
      >
        Try the preview →
      </Link>
    </li>
  );
}

/**
 * DigestMock — stylized "draft PR" card, sized for a quadrant cell.
 * Decorative; aria-hidden so screen readers skip past (the headline
 * and 1-line body carry the meaning).
 *
 * Voice rule: no colons. The category labels are Pill components, not
 * inline `Label:` colons. Pills aren't headings, so the engine's
 * no-trailing-period-on-headings rule passes without forcing colons.
 */
function DigestMock() {
  return (
    <div
      aria-hidden
      className="rounded-xl border border-line bg-canvas p-4 shadow-md shadow-canvas/40"
    >
      <div className="flex items-center gap-2">
        <Pill tone="stone" size="xs">
          Draft
        </Pill>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-quiet">
          Pull request
        </span>
        <span className="ml-auto text-[10px] text-quiet">Mon</span>
      </div>
      <p className="mt-2 text-xs font-semibold text-strong">
        ContentRX weekly review · Apr 28 to May 4
      </p>

      <ol className="mt-3 space-y-2 text-xs">
        <li className="flex items-center gap-2">
          <Pill tone="amber" size="xs">
            Action verbs
          </Pill>
          <p className="text-default">
            12 checks used &lsquo;Submit&rsquo;.
          </p>
        </li>
        <li className="flex items-center gap-2">
          <Pill tone="amber" size="xs">
            Plain language
          </Pill>
          <p className="text-default">
            7 reached for &lsquo;utilize&rsquo;.
          </p>
        </li>
        <li className="flex items-center gap-2">
          <Pill tone="amber" size="xs">
            Accessibility
          </Pill>
          <p className="text-default">
            4 read &lsquo;click here&rsquo;.
          </p>
        </li>
      </ol>

      <div className="mt-3 flex items-center gap-2 border-t border-line pt-2 text-[10px] uppercase tracking-wider text-quiet">
        <span aria-hidden>⚡</span>
        <span>0 checks</span>
        <span aria-hidden>·</span>
        <span>read-only</span>
      </div>
    </div>
  );
}
