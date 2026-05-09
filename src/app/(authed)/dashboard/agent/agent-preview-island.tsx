"use client";

/**
 * Client island for the /dashboard/agent preview pane.
 *
 * Single button, two panes (idle and preview). On click, posts to
 * /api/agent/preview and swaps the pane with the rendered markdown
 * + a small summary line. Errors render in a calm caution box.
 *
 * The preview is markdown — we render it as a `<pre>` block so the
 * customer sees exactly what they'd get in the GitHub PR description.
 * No client-side markdown rendering: the artifact is the markdown
 * itself, not a styled approximation. (When this lands in GitHub the
 * Markdown renderer there is the canonical view; rendering it twice
 * different ways is its own kind of drift.)
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";

type PreviewSummary = {
  totalFlags: number;
  headerVariant: string;
  windowDays: number;
  generatedAt: string;
};

type PreviewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; markdown: string; summary: PreviewSummary }
  | { kind: "error"; message: string };

type PreviewResponse = {
  markdown: string;
  summary: PreviewSummary;
};

export function AgentPreviewIsland() {
  const [state, setState] = useState<PreviewState>({ kind: "idle" });

  async function runPreview() {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/agent/preview", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setState({
          kind: "error",
          message: body?.error ?? "Couldn't render the preview. Try again.",
        });
        return;
      }
      const data = (await res.json()) as PreviewResponse;
      setState({
        kind: "ready",
        markdown: data.markdown,
        summary: data.summary,
      });
    } catch {
      setState({
        kind: "error",
        message: "Couldn't reach the preview service. Check your connection.",
      });
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={runPreview}
          disabled={state.kind === "loading"}
          variant="primary"
        >
          {state.kind === "loading" ? "Rendering…" : "Run preview now"}
        </Button>
        <span className="text-xs text-quiet">
          0 checks consumed. Renders from your existing flag history.
        </span>
      </div>

      {state.kind === "error" && (
        <div
          role="alert"
          className="rounded-md border border-accent-caution-border bg-accent-caution-soft p-4 text-sm text-accent-caution-text"
        >
          <p className="font-semibold">Couldn&apos;t render the preview</p>
          <p className="mt-1">{state.message}</p>
        </div>
      )}

      {state.kind === "ready" && (
        <div className="space-y-3">
          <p className="text-xs text-quiet">
            Generated at{" "}
            <time className="font-mono">{state.summary.generatedAt}</time>{" "}
            from {state.summary.totalFlags}{" "}
            {state.summary.totalFlags === 1 ? "flag" : "flags"} in the
            last {state.summary.windowDays} days.
          </p>
          <div className="overflow-hidden rounded-md border border-line bg-canvas">
            <header className="border-b border-line bg-raised px-4 py-2 text-xs font-semibold uppercase tracking-wider text-quiet">
              Preview · Markdown
            </header>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words p-4 text-sm text-strong">
              {state.markdown}
            </pre>
          </div>
        </div>
      )}
    </section>
  );
}
