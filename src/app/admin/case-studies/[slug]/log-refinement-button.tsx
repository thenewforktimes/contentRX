"use client";

/**
 * Inline "Log to refinement-log" form, attached per-row on the
 * case-study detail page. Click expands the form pre-filled with
 * triggering-case context drawn from the engine result; submit calls
 * the same Server Action /admin/refinement-log uses.
 *
 * The Server Action itself is in src/app/admin/refinement-log/actions.ts
 * — auth is re-checked at the action boundary, the markdown writer is
 * pure, and Vercel's read-only FS surfaces as `write_failed` (matches
 * the B4b pattern).
 *
 * State that lives here: the open/closed toggle. Everything else
 * flows through the form fields and the Server Action.
 */

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { addRefinement } from "@/app/admin/refinement-log/actions";

interface Defaults {
  /** Pre-filled `triggering_case` text — already includes target slug,
   * source file, line number, head SHA, verdict, and the issue text.
   * Lives in a hidden field; user can't edit because the context is
   * generated, not opinion. */
  triggering_case: string;
  /** Best-effort hint for `current_category`. Pulled from the engine's
   * issue text. User edits to refine. */
  current_category_hint: string;
  /** Optional default title. Often the row's text, truncated. */
  title_hint: string;
}

export function LogRefinementButton({ defaults }: { defaults: Defaults }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-line-strong px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-default hover:bg-hover"
      >
        Log refinement
      </button>
    );
  }

  return (
    <form
      action={addRefinement}
      className="mt-3 space-y-3 rounded-md border border-line-strong bg-overlay p-3 text-xs"
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-quiet">
        New open refinement
      </p>

      {/* Triggering case is generated from row context — hidden so the
          founder doesn't need to retype the source location every time. */}
      <input
        type="hidden"
        name="triggering_case"
        value={defaults.triggering_case}
      />

      <Field
        label="Title (optional, short)"
        name="title"
        defaultValue={defaults.title_hint}
        placeholder="e.g. PRF-03 — legal-entity-suffix exception"
      />

      <Field
        label="Current category"
        name="current_category"
        defaultValue={defaults.current_category_hint}
        required
        placeholder="What standard / behavior does this affect?"
      />

      <FieldTextarea
        label="Proposed refinement"
        name="proposed_split"
        required
        placeholder="What should change? (e.g. 'Suppress PRF-03 when trailing period is part of legal-entity suffix')"
      />

      <FieldTextarea
        label="Architectural consequence"
        name="architectural_consequence"
        required
        placeholder="What code/data does this touch? Allowlist? New content_type? Filter?"
      />

      <FieldTextarea
        label="Note (optional)"
        name="note"
        placeholder="Anything else — adjacent patterns, related standards, links to triggering cases."
      />

      <details>
        <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-quiet">
          Triggering case (auto-generated, hidden)
        </summary>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded bg-raised p-2 font-sans text-[11px] text-default">
{defaults.triggering_case}
        </pre>
      </details>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          className="rounded-md border border-stone-900 bg-stone-900 px-3 py-1 text-xs font-medium text-white hover:bg-stone-800 dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
        >
          Log refinement
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-line-strong px-3 py-1 text-xs text-stone-700 hover:bg-hover dark:text-stone-200"
        >
          Cancel
        </button>
        <span className="ml-auto text-[10px] text-quiet">
          Vercel runtime is read-only — saves only land in local checkouts.
        </span>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  required,
  placeholder,
  defaultValue,
}: {
  label: string;
  name: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-quiet">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </span>
      <Input
        type="text"
        name={name}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue}
        className="py-1 text-xs"
      />
    </label>
  );
}

function FieldTextarea({
  label,
  name,
  required,
  placeholder,
  defaultValue,
}: {
  label: string;
  name: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-quiet">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </span>
      <textarea
        name={name}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue}
        rows={3}
        className="rounded border border-line-strong bg-raised px-2 py-1 font-sans text-xs leading-relaxed text-strong focus:border-stone-500 focus:outline-none"
      />
    </label>
  );
}
