/**
 * `/admin/refinement-log` — taxonomy refinement candidates UI.
 *
 * Phase B4 of the post-pivot rolling plan. Renders
 * `taxonomy_refinement_log.md` as a structured page grouped by
 * status (open / auto-detected / approved / declined). Each entry
 * surfaces the load-bearing fields: current category, proposed
 * split, triggering case, architectural consequence, verdict, date
 * logged.
 *
 * Read-only in this PR. The architecture doc envisions a form-based
 * entry path that enforces the structured-entry shape; that ships in
 * a follow-up PR (B4b) once the page provides enough surface to make
 * the form's value visible.
 *
 * Auth handled by `src/app/admin/layout.tsx`.
 */

import {
  getRefinementLog,
  type RefinementEntry,
  type RefinementStatus,
} from "@/lib/admin-refinement-log.server";
import { LinkifyStandards } from "@/components/admin/linkify-standards";
import { Input, Textarea } from "@/components/ui/input";
import { getStandardsLibrary } from "@/lib/admin-substrate.server";
import { addRefinement } from "./actions";

const SECTION_ORDER: Array<{
  status: RefinementStatus;
  title: string;
  description: string;
  empty: string;
}> = [
  {
    status: "open",
    title: "Open",
    description:
      "Refinement candidates Robert has triaged manually. Verdicts pending.",
    empty: "No open refinements.",
  },
  {
    status: "auto_detected",
    title: "Auto-detected",
    description:
      "Candidates surfaced by `tools/refinement_candidate_detector.py` from the nightly signal dump. Triage during the weekly review rhythm.",
    empty: "No auto-detected candidates at the last run.",
  },
  {
    status: "approved",
    title: "Approved",
    description:
      "Candidates that cleared the decision criterion (the split changes downstream behavior, demonstrated by ≥1 verdict flip on the held-out golden set).",
    empty: "None yet.",
  },
  {
    status: "declined",
    title: "Declined",
    description:
      "Candidates rejected — either the split didn't change behavior or the cost-of-complexity outweighed the gain.",
    empty: "None yet.",
  },
];

export const metadata = {
  title: "Refinement log · ContentRX admin",
  robots: { index: false, follow: false },
};

export default function AdminRefinementLogPage() {
  const log = getRefinementLog();
  const totals = {
    open: log.byStatus.open.length,
    auto_detected: log.byStatus.auto_detected.length,
    approved: log.byStatus.approved.length,
    declined: log.byStatus.declined.length,
  };
  // Pre-compute the set of valid standard IDs once so each Field can
  // linkify its content without re-parsing the substrate per render.
  // Refinement entries routinely name rules in the triggering-case /
  // architectural-consequence text; these become clickable jumps to
  // the per-standard mission-control panel at /admin/model/standards/[id].
  const { categories } = getStandardsLibrary();
  const validStandardIds = new Set<string>();
  for (const cat of categories) {
    for (const s of cat.standards) {
      validStandardIds.add(s.id);
    }
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-strong">
            Refinement log
          </h1>
          <p className="mt-1 text-sm text-quiet">
            Granularity gaps in the content type taxonomy, surfaced through
            real-world triage. The decision criterion lives at the top of
            <code className="mx-1 font-mono text-xs">taxonomy_refinement_log.md</code>
            : a split only happens when the distinction would change which
            standards fire, how they&apos;re weighted, or whether a violation flags.
          </p>
        </div>
        <dl className="flex flex-wrap gap-3 text-xs text-default">
          <Stat label="Open" value={totals.open} />
          <Stat label="Auto-detected" value={totals.auto_detected} />
          <Stat label="Approved" value={totals.approved} />
          <Stat label="Declined" value={totals.declined} />
        </dl>
      </header>

      <details className="rounded-lg border border-line bg-raised p-4">
        <summary className="cursor-pointer text-sm font-semibold text-strong">
          Add a refinement candidate
        </summary>
        <p className="mt-2 text-xs text-quiet">
          Adds a structured entry to the <code className="font-mono">## Open refinements</code>{" "}
          section of the markdown log. The next REF-NNN id is assigned automatically.
          The action writes the file in place — works in local dev, fails in the
          read-only Vercel runtime; commit + push the change to publish.
        </p>
        <RefinementForm />
      </details>

      {SECTION_ORDER.map((section) => (
        <section
          key={section.status}
          aria-labelledby={`section-${section.status}`}
          className="space-y-3"
        >
          <header>
            <h2
              id={`section-${section.status}`}
              className="text-sm font-semibold uppercase tracking-wide text-quiet"
            >
              {section.title} ({log.byStatus[section.status].length})
            </h2>
            <p className="mt-1 text-xs text-quiet">
              {section.description}
            </p>
          </header>
          {log.byStatus[section.status].length === 0 ? (
            <p className="rounded-lg border border-dashed border-line-strong bg-raised px-4 py-3 text-xs text-quiet">
              {section.empty}
            </p>
          ) : (
            <ul className="space-y-3">
              {log.byStatus[section.status].map((entry) => (
                <RefinementCard
                  key={`${entry.status}-${entry.id}`}
                  entry={entry}
                  validStandardIds={validStandardIds}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function RefinementCard({
  entry,
  validStandardIds,
}: {
  entry: RefinementEntry;
  validStandardIds: ReadonlySet<string>;
}) {
  return (
    <li className="rounded-lg border border-line bg-raised p-4">
      <header className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-xs text-default">
          {entry.id}
        </span>
        {entry.title && (
          <span className="text-sm font-semibold text-strong">
            <LinkifyStandards
              text={entry.title}
              validIds={validStandardIds}
            />
          </span>
        )}
        {entry.date_logged && (
          <span className="ml-auto font-mono text-[10px] text-quiet">
            {entry.date_logged}
          </span>
        )}
      </header>
      <dl className="mt-3 space-y-3 text-sm">
        {/* current_category is a category id, not a standard id —
            keep it raw mono so it doesn't get spuriously linkified. */}
        <Field label="Current category" value={entry.current_category} mono />
        <Field
          label="Proposed split"
          value={entry.proposed_split}
          linkify={validStandardIds}
        />
        <Field
          label="Triggering case"
          value={entry.triggering_case}
          linkify={validStandardIds}
        />
        <Field
          label="Architectural consequence"
          value={entry.architectural_consequence}
          linkify={validStandardIds}
        />
        <Field
          label="Note"
          value={entry.note}
          linkify={validStandardIds}
        />
        <Field
          label="Verdict"
          value={entry.verdict}
          highlight
          linkify={validStandardIds}
        />
      </dl>
    </li>
  );
}

function Field({
  label,
  value,
  mono,
  highlight,
  linkify,
}: {
  label: string;
  value: string | undefined;
  mono?: boolean;
  highlight?: boolean;
  /**
   * When provided, standard-id mentions in `value` (CLR-01, VT-04,
   * etc.) that exist in this set are rendered as links to the
   * per-standard mission-control page. Spurious matches that look
   * like an ID but aren't valid render as plain text — never as a
   * dead link.
   */
  linkify?: ReadonlySet<string>;
}) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-quiet">
        {label}
      </dt>
      <dd
        className={`mt-1 whitespace-pre-line ${
          mono ? "font-mono text-xs" : "text-sm"
        } ${
          highlight
            ? "rounded bg-amber-50 px-2 py-1 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
            : "text-default"
        }`}
      >
        {linkify ? (
          <LinkifyStandards text={value} validIds={linkify} />
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function RefinementForm() {
  return (
    <form action={addRefinement} className="mt-4 space-y-3">
      <FormField
        label="Title (optional)"
        name="title"
        placeholder="ui_label → ui_label + section_header"
      />
      <FormField
        label="Current category"
        name="current_category"
        required
        placeholder="ui_label"
      />
      <FormField
        label="Proposed split"
        name="proposed_split"
        required
        textarea
        placeholder="Distinguish component-level labels from section-level headers."
      />
      <FormField
        label="Triggering case"
        name="triggering_case"
        required
        textarea
        placeholder="SCAN-2026-04-25-001 — 'Today's focus'"
      />
      <FormField
        label="Architectural consequence"
        name="architectural_consequence"
        required
        textarea
        placeholder="PRF-03 applies to section headers but not to component labels."
      />
      <FormField label="Note (optional)" name="note" textarea />
      <FormField
        label="Date logged"
        name="date_logged"
        type="date"
        defaultValue={todayIso()}
      />
      <button
        type="submit"
        className="rounded-md bg-stone-900 px-4 py-2 text-xs font-medium text-white hover:bg-stone-800 dark:bg-white dark:text-black dark:hover:bg-stone-100"
      >
        Add candidate
      </button>
    </form>
  );
}

function FormField({
  label,
  name,
  type = "text",
  textarea,
  required,
  placeholder,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  textarea?: boolean;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
}) {
  return (
    <label className="block text-xs">
      <span className="font-semibold text-default">
        {label}
        {required && <span className="ml-1 text-rose-500">*</span>}
      </span>
      {textarea ? (
        <Textarea
          name={name}
          required={required}
          placeholder={placeholder}
          defaultValue={defaultValue}
          rows={2}
          className="mt-1"
        />
      ) : (
        <Input
          type={type}
          name={name}
          required={required}
          placeholder={placeholder}
          defaultValue={defaultValue}
          className="mt-1"
        />
      )}
    </label>
  );
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-raised px-3 py-2">
      <dt className="text-[10px] uppercase tracking-wide text-quiet">
        {label}
      </dt>
      <dd className="font-mono text-base font-semibold text-strong">
        {value}
      </dd>
    </div>
  );
}
