"use client";

/**
 * Team-rules client UI.
 *
 * One big client island that owns the list of standards + current
 * team rules, handles toggle-to-disable, links off to the /[id]
 * editor for overrides/adds, and provides an inline "Add custom
 * rule" form. Everything POSTs to /api/team-rules.
 *
 * The server component (page.tsx) passes the full standards library
 * and the team's current rules in as initial props; afterwards we
 * maintain state optimistically and re-fetch only on major mutations.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertDialog } from "@/components/alert-dialog";
import type { CategorySummary } from "@/lib/standards";

export type TeamRule = {
  id: string;
  teamOwnerUserId: string;
  standardId: string;
  action: "disable" | "override" | "add";
  ruleJson: Record<string, unknown>;
};

type Props = {
  categories: CategorySummary[];
  rules: TeamRule[];
  isAdmin: boolean;
};

type PreviewResult = {
  action: string;
  standard_id: string;
  window_violations: number;
  would_remove_violations: number;
  would_add_violations: number | null;
  would_convert_to_review: number;
  sample_before: Array<{
    id: string;
    standard_id: string;
    severity: string;
    moment: string | null;
    content_type: string;
    text_hash: string;
    created_at: string;
  }>;
  note: string | null;
};

type PendingDisable = {
  standardId: string;
  preview: PreviewResult | null;
  loading: boolean;
  error: string | null;
};

export function TeamRulesClient({ categories, rules, isAdmin }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [localRules, setLocalRules] = useState<TeamRule[]>(rules);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // BUILD_PLAN_v2 Session 12 — inline preview before committing a
  // disable. The commit button in the dialog only enables after the
  // preview call returns (or errors with a specific message).
  const [pendingDisable, setPendingDisable] =
    useState<PendingDisable | null>(null);

  function byStandardId(id: string) {
    return localRules.filter((r) => r.standardId === id);
  }
  const customRules = localRules.filter((r) => r.action === "add");

  async function requestDisable(standardId: string) {
    if (!isAdmin) return;
    setError(null);
    setPendingDisable({ standardId, preview: null, loading: true, error: null });
    try {
      const res = await fetch("/api/team-rules/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          change: { action: "disable", standard_id: standardId },
          window: "30d",
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to preview");
      }
      const body = await res.json();
      const preview: PreviewResult = body?.result;
      setPendingDisable({
        standardId,
        preview,
        loading: false,
        error: null,
      });
    } catch (err) {
      setPendingDisable({
        standardId,
        preview: null,
        loading: false,
        error:
          err instanceof Error
            ? err.message
            : "Could not load preview. Disable anyway?",
      });
    }
  }

  async function confirmDisable(standardId: string) {
    setBusyId(standardId);
    setPendingDisable(null);
    try {
      const res = await fetch("/api/team-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disable", standard_id: standardId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to disable");
      }
      const { rule } = await res.json();
      setLocalRules((prev) => {
        const without = prev.filter(
          (r) => !(r.standardId === standardId && r.action === "disable"),
        );
        return [...without, rule];
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disable");
    } finally {
      setBusyId(null);
    }
  }

  async function removeRule(ruleId: string) {
    if (!isAdmin) return;
    setBusyId(ruleId);
    setError(null);
    try {
      const res = await fetch(`/api/team-rules/${ruleId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to remove");
      }
      setLocalRules((prev) => prev.filter((r) => r.id !== ruleId));
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      {!isAdmin && (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
          Read-only — only the team owner can edit rules.
        </div>
      )}

      <AddCustomRuleCard
        disabled={!isAdmin}
        onCreated={(rule) => setLocalRules((prev) => [...prev, rule])}
        onError={setError}
      />

      {customRules.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Custom team rules</h2>
          <ul className="flex flex-col gap-2">
            {customRules.map((rule) => (
              <CustomRuleRow
                key={rule.id}
                rule={rule}
                isAdmin={isAdmin}
                busy={busyId === rule.id}
                onRemove={() => removeRule(rule.id)}
              />
            ))}
          </ul>
        </section>
      )}

      {categories.map((category) => (
        <section key={category.id}>
          <h2 className="mb-3 text-sm font-semibold">{category.name}</h2>
          <ul className="flex flex-col gap-2">
            {category.standards.map((std) => {
              const rulesForThis = byStandardId(std.id);
              const disabledRule = rulesForThis.find(
                (r) => r.action === "disable",
              );
              return (
                <StandardRow
                  key={std.id}
                  standardId={std.id}
                  rule={std.rule}
                  isAdmin={isAdmin}
                  isDisabled={Boolean(disabledRule)}
                  disabledRuleId={disabledRule?.id}
                  busy={
                    busyId === std.id || busyId === (disabledRule?.id ?? "")
                  }
                  onEnable={async () => {
                    if (disabledRule) await removeRule(disabledRule.id);
                  }}
                  onDisable={() => requestDisable(std.id)}
                />
              );
            })}
          </ul>
        </section>
      ))}

      {pendingDisable && (
        <DisablePreviewDialog
          pending={pendingDisable}
          onCancel={() => setPendingDisable(null)}
          onConfirm={() => confirmDisable(pendingDisable.standardId)}
        />
      )}
    </div>
  );
}

function DisablePreviewDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: PendingDisable;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const preview = pending.preview;
  const description = (() => {
    if (pending.loading) {
      return "Computing impact on the last 30 days of team evaluations…";
    }
    if (pending.error) {
      return pending.error;
    }
    if (!preview) return "";
    const removed = preview.would_remove_violations;
    if (preview.window_violations === 0) {
      return `No team violations logged in the last 30 days — disabling ${pending.standardId} is safe.`;
    }
    if (removed === 0) {
      return (
        preview.note ??
        `${pending.standardId} hasn't fired on your team in the last 30 days. Disabling has no historical effect.`
      );
    }
    return `Disabling ${pending.standardId} would have removed ${removed} violation${
      removed === 1 ? "" : "s"
    } from your team's evaluations in the last 30 days (out of ${preview.window_violations} total).`;
  })();

  return (
    <AlertDialog
      open
      title={`Disable ${pending.standardId}?`}
      description={description}
      confirmLabel={pending.loading ? "Previewing…" : "Disable"}
      cancelLabel="Keep it on"
      tone="danger"
      onConfirm={pending.loading ? () => {} : onConfirm}
      onCancel={onCancel}
    />
  );
}

// ---------------------------------------------------------------------------
// Standard row — toggle + link to editor
// ---------------------------------------------------------------------------
function StandardRow({
  standardId,
  rule,
  isAdmin,
  isDisabled,
  busy,
  onEnable,
  onDisable,
}: {
  standardId: string;
  rule: string;
  isAdmin: boolean;
  isDisabled: boolean;
  disabledRuleId?: string;
  busy: boolean;
  onEnable: () => void;
  onDisable: () => void;
}) {
  return (
    <li className="flex items-start gap-3 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs dark:bg-neutral-900">
            {standardId}
          </code>
          {isDisabled && (
            <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium uppercase text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
              disabled
            </span>
          )}
        </div>
        <p
          className={`mt-1 text-xs ${
            isDisabled
              ? "text-neutral-400 line-through dark:text-neutral-600"
              : "text-neutral-600 dark:text-neutral-400"
          }`}
        >
          {rule}
        </p>
      </div>
      <div className="flex gap-2">
        {isAdmin && (
          <button
            type="button"
            disabled={busy}
            onClick={isDisabled ? onEnable : onDisable}
            className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            {isDisabled ? "Enable" : "Disable"}
          </button>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Custom rule row — summary + delete
// ---------------------------------------------------------------------------
function CustomRuleRow({
  rule,
  isAdmin,
  busy,
  onRemove,
}: {
  rule: TeamRule;
  isAdmin: boolean;
  busy: boolean;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const fields = rule.ruleJson as {
    title?: string;
    rule?: string;
    pattern?: string;
    severity?: string;
  };
  return (
    <li className="flex items-start gap-3 rounded-md border border-blue-200 bg-blue-50/40 p-3 dark:border-blue-900 dark:bg-blue-950/30">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <code className="rounded bg-blue-100 px-1.5 py-0.5 font-mono text-xs text-blue-900 dark:bg-blue-900 dark:text-blue-100">
            {rule.standardId}
          </code>
          <span className="text-xs font-medium">{fields.title}</span>
        </div>
        <p className="mt-1 text-xs text-neutral-700 dark:text-neutral-300">
          {fields.rule}
        </p>
        <p className="mt-1 font-mono text-[11px] text-neutral-500">
          pattern: <code>{fields.pattern}</code>
        </p>
      </div>
      <div className="flex gap-2">
        {isAdmin && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(true)}
            className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
          >
            Remove
          </button>
        )}
      </div>
      <AlertDialog
        open={confirming}
        title="Remove this custom rule?"
        description={`Rule "${fields.title ?? rule.standardId}" will no longer apply to your team's evaluations. You can re-add it later.`}
        confirmLabel="Remove rule"
        cancelLabel="Keep rule"
        tone="danger"
        onConfirm={() => {
          setConfirming(false);
          onRemove();
        }}
        onCancel={() => setConfirming(false)}
      />
    </li>
  );
}

// ---------------------------------------------------------------------------
// Add custom rule form
// ---------------------------------------------------------------------------
function AddCustomRuleCard({
  disabled,
  onCreated,
  onError,
}: {
  disabled: boolean;
  onCreated: (rule: TeamRule) => void;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [rule, setRule] = useState("");
  const [pattern, setPattern] = useState("");
  const [caseInsensitive, setCaseInsensitive] = useState(true);
  const [severity, setSeverity] = useState<"low" | "medium" | "high">("medium");
  const [busy, setBusy] = useState(false);

  if (disabled) return null;

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch("/api/team-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          rule_json: {
            title,
            rule,
            pattern,
            case_insensitive: caseInsensitive,
            severity,
          },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to create rule");
      }
      const { rule: created } = await res.json();
      onCreated(created);
      setOpen(false);
      setTitle("");
      setRule("");
      setPattern("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to create rule");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 dark:bg-white dark:text-black"
      >
        Add custom rule
      </button>
    );
  }

  return (
    <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="mb-3 text-sm font-semibold">New custom rule</h2>
      <div className="flex flex-col gap-3">
        <label className="text-xs">
          <span className="mb-1 block text-neutral-600 dark:text-neutral-400">
            Title
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="No 'revolutionary'"
            className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-neutral-600 dark:text-neutral-400">
            Rule text (shown to anyone who trips this)
          </span>
          <textarea
            rows={2}
            value={rule}
            onChange={(e) => setRule(e.target.value)}
            placeholder="Avoid the word 'revolutionary'. Describe what's new and why instead."
            className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-neutral-600 dark:text-neutral-400">
            Regex pattern — matched against the text being checked
          </span>
          <input
            type="text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="\brevolutionary\b"
            className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={caseInsensitive}
              onChange={(e) => setCaseInsensitive(e.target.checked)}
            />
            Case-insensitive
          </label>
          <label className="flex items-center gap-2">
            <span className="text-neutral-600 dark:text-neutral-400">
              Severity
            </span>
            <select
              value={severity}
              onChange={(e) =>
                setSeverity(e.target.value as "low" | "medium" | "high")
              }
              className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy || !title || !rule || !pattern}
            onClick={submit}
            className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {busy ? "Saving…" : "Create rule"}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            Cancel
          </button>
        </div>
      </div>
    </section>
  );
}
