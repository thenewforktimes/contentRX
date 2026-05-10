/**
 * TrustCell — quadrant cell housing the four trust-page links.
 *
 * 2026-05-11 polish pass:
 *   - Eyebrow stays "Receipts" (Robo's pick — less austere than
 *     "Proof").
 *   - Headline switched from "The pages we publish." to "Because
 *     we care." Reframes the cell from describing what the pages
 *     are to naming why they exist.
 *   - Body line dropped. The 2x2 link grid carries the cell now.
 *   - Each link gets a stroke-SVG icon next to the label so the
 *     cell stops feeling visually empty against the other cells.
 *
 * Icons are hand-rolled inline SVGs in the same stroke-weight + cap
 * style as `surface-icons.tsx`. They sit in `text-quiet` and lift
 * to `text-strong` on hover via the parent Link's hover styles.
 */

import Link from "next/link";
import { Eyebrow } from "@/components/ui/eyebrow";

type TrustLink = {
  label: string;
  href: string;
  Icon: React.ComponentType<{ className?: string }>;
};

const LINKS: readonly TrustLink[] = [
  { label: "Privacy", href: "/privacy", Icon: LockIcon },
  { label: "Security", href: "/security", Icon: ShieldIcon },
  { label: "Install", href: "/install", Icon: DownloadIcon },
  { label: "Accuracy", href: "/accuracy", Icon: GaugeIcon },
] as const;

export function TrustCell() {
  return (
    <li className="flex flex-col rounded-2xl border border-line bg-raised p-6 sm:p-8">
      <Eyebrow>Receipts</Eyebrow>
      <p className="mt-3 text-lg font-semibold text-strong sm:text-xl">
        Because we care.
      </p>

      <ul
        aria-label="Trust pages"
        className="mt-auto grid grid-cols-2 gap-4 pt-8 sm:gap-5"
      >
        {LINKS.map((l) => (
          <li key={l.label}>
            <Link
              href={l.href}
              className="group flex items-center gap-3 text-base font-medium text-default underline underline-offset-2 hover:text-strong"
            >
              <span
                aria-hidden
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line bg-canvas text-quiet group-hover:text-strong"
              >
                <l.Icon className="h-5 w-5" />
              </span>
              {l.label} →
            </Link>
          </li>
        ))}
      </ul>
    </li>
  );
}

/* Hand-rolled stroke SVGs. Same line-weight (2px), same caps and
 * joins (round) as the surface-icons set. Each at 24x24. */

function LockIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="4" y="11" width="16" height="9" rx="1.5" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      <circle cx="12" cy="15.5" r="1.25" fill="currentColor" />
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 3 L4 6.5 V12 c0 4.5 3.4 7.8 8 9 4.6-1.2 8-4.5 8-9 V6.5 L12 3 Z" />
      <path d="M9 12.5 L11 14.5 L15 10.5" />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 4 V15" />
      <path d="M7 10 L12 15 L17 10" />
      <path d="M5 19 H19" />
    </svg>
  );
}

function GaugeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M3 18 a9 9 0 0 1 18 0" />
      <path d="M12 18 L17 8.5" />
      <circle cx="12" cy="18" r="1.25" fill="currentColor" />
    </svg>
  );
}
