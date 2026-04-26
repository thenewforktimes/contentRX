/**
 * `/admin` index — landing page for the founder dashboard.
 *
 * Phase B1 of the post-pivot rolling plan. Lists the admin surfaces
 * that have shipped so far. Subsequent Phase B sessions add cards
 * here as `/admin/model`, `/admin/queue`, `/admin/refinement-log`,
 * `/admin/calibration`, `/admin/reports`, and `/admin/essay-drafts`
 * land.
 *
 * Auth is enforced by the surrounding `layout.tsx`; this page only
 * renders when the request has cleared `isContentRXAdmin()`.
 */

import Link from "next/link";

type AdminLink = {
  href: string;
  title: string;
  description: string;
  status: "live" | "planned";
};

const ADMIN_LINKS: AdminLink[] = [
  {
    href: "/admin/rule-review",
    title: "Rule review",
    description:
      "Cross-team override aggregation. Standards with elevated override rates surface here for triage.",
    status: "live",
  },
  {
    href: "/admin/model",
    title: "Model",
    description:
      "Browsable taxonomy — moments, standards, version history, examples corpus, influences.",
    status: "live",
  },
  {
    href: "/admin/queue",
    title: "Review queue",
    description:
      "Daily 15-minute review rhythm. Cases cluster by review_reason subtype with agree/override/skip.",
    status: "live",
  },
  {
    href: "/admin/refinement-log",
    title: "Refinement log",
    description:
      "Taxonomy refinement candidates — proposed splits, retirements, new moments, new standards.",
    status: "live",
  },
  {
    href: "/admin/calibration",
    title: "Calibration",
    description:
      "Kappa over time, drift detection, override stream. Substrate that produces /accuracy + the weekly calibration log.",
    status: "live",
  },
  {
    href: "/admin/reports",
    title: "Reports",
    description:
      "Preview-before-publish gate. Generated weekly + quarterly reports surface here before going to docs.",
    status: "live",
  },
  {
    href: "/admin/essay-drafts",
    title: "Essay drafts",
    description:
      "200-word scaffold drawn from the latest report — removes the cold-start tax on writing.",
    status: "live",
  },
];

export default function AdminIndexPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          Founder dashboard
        </h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Substrate UI for the daily review rhythm, calibration log,
          refinement-log, and report publication gate.
        </p>
      </header>
      <ul className="grid gap-3 sm:grid-cols-2">
        {ADMIN_LINKS.map((link) => (
          <li key={link.href}>
            <AdminCard link={link} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function AdminCard({ link }: { link: AdminLink }) {
  const isPlanned = link.status === "planned";
  const cardClasses = `block rounded-lg border bg-white p-4 transition dark:bg-neutral-900 ${
    isPlanned
      ? "border-dashed border-neutral-300 opacity-60 dark:border-neutral-700"
      : "border-neutral-200 hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
  }`;
  const body = (
    <>
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {link.title}
        </h2>
        {isPlanned && (
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
            Planned
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
        {link.description}
      </p>
    </>
  );
  if (isPlanned) {
    return <div className={cardClasses}>{body}</div>;
  }
  return (
    <Link href={link.href} className={cardClasses}>
      {body}
    </Link>
  );
}
