/**
 * OneApprovalCell — quadrant cell for the procurement-friction
 * differentiator.
 *
 * 2026-05-10 lower-fold rebuild. The prior "Built for your stack"
 * 4-card section had One approval as a wide hero card with a 3-card
 * trust-link row beneath. This version converts it to a single
 * quadrant cell paired with the agent cell in a 2-up row.
 *
 * Hero visual: typography-only. Three stacked anchors (price,
 * install time, contracts-needed) with the CTA below. No fake
 * UI mocks; honest by construction. Robo's "no ghost UI" rule:
 * we don't have a custom checkout flow to depict (Stripe handles
 * checkout via their hosted pages), so the cell leans on
 * typographic discipline instead.
 *
 * The trust-link strip (Privacy / Security / Install / Accuracy)
 * lives below this cell in page.tsx as an inline strip, not a
 * card grid.
 */

import Link from "next/link";
import { Eyebrow } from "@/components/ui/eyebrow";

export function OneApprovalCell() {
  return (
    <li className="flex flex-col rounded-2xl border border-line bg-raised p-6 sm:p-8">
      <Eyebrow>One approval</Eyebrow>
      <p className="mt-3 text-lg font-semibold text-strong sm:text-xl">
        One bill. No new vendor.
      </p>
      <p className="mt-2 text-sm text-default">
        Same approval pattern as Slack or Figma.
      </p>

      <div className="flex flex-1 flex-col justify-center gap-3 py-6">
        <AnchorLine value="$39" unit="/month" />
        <AnchorLine value="5" unit="minute install" />
        <AnchorLine value="0" unit="LLM contracts" />
      </div>

      <Link
        href="/pricing"
        className="inline-flex w-fit items-center gap-1 text-sm font-medium text-default underline underline-offset-2 hover:text-strong"
      >
        See pricing →
      </Link>
    </li>
  );
}

/**
 * Single typographic anchor row. Big number on the left, small unit
 * label on the right. Three of these stack to form the cell's hero
 * block. The display weight on the value carries the visual punch
 * the cell needs without resorting to fake UI.
 */
function AnchorLine({ value, unit }: { value: string; unit: string }) {
  return (
    <div className="flex items-baseline gap-2 border-b border-line/60 pb-2 last:border-b-0">
      <span className="text-3xl font-bold tracking-tight text-accent-affirm-text sm:text-4xl">
        {value}
      </span>
      <span className="text-sm text-default">{unit}</span>
    </div>
  );
}
