"use client";

/**
 * Client-side form for `/dashboard/calibrate`. Records which side
 * the user picked for each pair, then submits the batch to
 * `/api/preferences/session`.
 */

import { useState, useTransition } from "react";

/**
 * The shape `/dashboard/calibrate` ships to the client. Per ADR
 * 2026-04-25 the substrate fields (`standard_id`, `rule_version`,
 * `rationale_chain`) must NOT cross the user-facing boundary, so
 * `pair_id` is the only identifier on this surface — it's an
 * internal cuid the server uses to correlate the user's pick back
 * to the originating PreferencePair row, with no taxonomy meaning
 * to the user.
 */
export interface PairPublic {
  pair_id: string;
  moment: string;
  content_type: string;
  left_text: string;
  right_text: string;
  prompt: string | null;
}

type Side = "left" | "right" | "neither";

export function CalibrateForm({ pairs }: { pairs: PairPublic[] }) {
  const [picks, setPicks] = useState<Record<string, Side>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [startedAt] = useState(() => Date.now());
  const [submitting, startTransition] = useTransition();
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allAnswered = pairs.every((p) => picks[p.pair_id]);

  function pick(pairId: string, side: Side) {
    setPicks((prev) => ({ ...prev, [pairId]: side }));
  }

  function submit() {
    setError(null);
    const responses = pairs.map((p) => ({
      pair_id: p.pair_id,
      preferred: picks[p.pair_id]!,
      note: notes[p.pair_id]?.trim() || undefined,
      time_ms: Math.max(0, Date.now() - startedAt),
    }));

    startTransition(async () => {
      const res = await fetch("/api/preferences/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responses }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setSubmitted(true);
    });
  }

  if (submitted) {
    return (
      <section className="rounded-lg border border-emerald-300 bg-emerald-50 p-6 text-sm dark:border-emerald-800 dark:bg-emerald-950/40">
        <p className="font-semibold">Thank you.</p>
        <p className="mt-1 text-neutral-700 dark:text-neutral-300">
          Your picks land in the calibration set. The next prompt
          surfaces in seven days.
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {pairs.map((p, i) => (
        <article
          key={p.pair_id}
          className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800"
        >
          <header className="mb-4">
            <p className="text-xs font-mono uppercase tracking-widest text-neutral-500 dark:text-neutral-300">
              Pair {i + 1} of {pairs.length} · {p.moment} · {p.content_type}
            </p>
          </header>
          {p.prompt && (
            <p className="mb-4 text-sm font-medium">{p.prompt}</p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <ChoiceCard
              label="A"
              text={p.left_text}
              selected={picks[p.pair_id] === "left"}
              onClick={() => pick(p.pair_id, "left")}
            />
            <ChoiceCard
              label="B"
              text={p.right_text}
              selected={picks[p.pair_id] === "right"}
              onClick={() => pick(p.pair_id, "right")}
            />
          </div>
          <div className="mt-3 flex items-center gap-4">
            <button
              type="button"
              onClick={() => pick(p.pair_id, "neither")}
              className={`text-xs underline-offset-2 ${
                picks[p.pair_id] === "neither"
                  ? "font-semibold underline"
                  : "text-neutral-500 hover:underline"
              }`}
            >
              Neither reads well
            </button>
            <input
              type="text"
              placeholder="Optional note (≤500 chars)"
              value={notes[p.pair_id] ?? ""}
              onChange={(e) =>
                setNotes((prev) => ({
                  ...prev,
                  [p.pair_id]: e.target.value.slice(0, 500),
                }))
              }
              className="flex-1 rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-xs dark:border-neutral-700"
            />
          </div>
        </article>
      ))}

      {error && (
        <p className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={!allAnswered || submitting}
        onClick={submit}
        className="w-max rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
      >
        {submitting ? "Submitting…" : "Submit picks"}
      </button>
    </div>
  );
}

function ChoiceCard({
  label,
  text,
  selected,
  onClick,
}: {
  label: string;
  text: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start gap-2 rounded-md border p-3 text-left text-sm transition-colors ${
        selected
          ? "border-black bg-neutral-100 dark:border-white dark:bg-neutral-900"
          : "border-neutral-200 hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
      }`}
    >
      <span className="text-xs font-mono uppercase tracking-widest text-neutral-500">
        {label}
      </span>
      <span className="whitespace-pre-wrap">{text}</span>
    </button>
  );
}
