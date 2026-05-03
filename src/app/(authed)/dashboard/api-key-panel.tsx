"use client";

/**
 * Client-side API key panel.
 *
 * Talks to /api/dashboard/api-key via fetch. The raw key returned by POST
 * is surfaced exactly once inside a revealable box with a copy button, and
 * the component explicitly warns the user that we can't show it again.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertDialog } from "@/components/alert-dialog";

type Props = {
  initialPrefix: string | null;
  initialCreatedAt: string | null;
};

type KeyState =
  | { kind: "idle" }
  | { kind: "loading"; action: "rotate" | "revoke" }
  | { kind: "error"; message: string }
  | { kind: "fresh"; rawKey: string; prefix: string; createdAt: string };

type CopyState = "idle" | "copied" | "failed";

export function ApiKeyPanel({ initialPrefix, initialCreatedAt }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [prefix, setPrefix] = useState<string | null>(initialPrefix);
  const [createdAt, setCreatedAt] = useState<string | null>(initialCreatedAt);
  const [state, setState] = useState<KeyState>({ kind: "idle" });
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  async function rotate() {
    setState({ kind: "loading", action: "rotate" });
    try {
      const res = await fetch("/api/dashboard/api-key", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          body?.error ?? "Couldn't rotate the key. Try again. If it keeps happening, email hello@contentrx.io.",
        );
      }
      const body = await res.json();
      setPrefix(body.prefix);
      setCreatedAt(body.created_at);
      setState({
        kind: "fresh",
        rawKey: body.key,
        prefix: body.prefix,
        createdAt: body.created_at,
      });
      // Refresh server component so the stored prefix stays in sync if
      // the user navigates away and back.
      startTransition(() => router.refresh());
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Couldn't rotate the key. Try again. If it keeps happening, email hello@contentrx.io.";
      setState({ kind: "error", message });
    }
  }

  async function revoke() {
    setConfirmingRevoke(false);
    setState({ kind: "loading", action: "revoke" });
    try {
      const res = await fetch("/api/dashboard/api-key", { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          body?.error ?? "Couldn't revoke the key. Try again. If it keeps happening, email hello@contentrx.io.",
        );
      }
      setPrefix(null);
      setCreatedAt(null);
      setState({ kind: "idle" });
      startTransition(() => router.refresh());
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Couldn't revoke the key. Try again. If it keeps happening, email hello@contentrx.io.";
      setState({ kind: "error", message });
    }
  }

  async function copyKey(key: string) {
    try {
      await navigator.clipboard.writeText(key);
      setCopyState("copied");
      setTimeout(
        () => setCopyState((s) => (s === "copied" ? "idle" : s)),
        2000,
      );
    } catch {
      setCopyState("failed");
    }
  }

  const isLoading = state.kind === "loading";
  const hasKey = prefix !== null;

  return (
    <section className="rounded-lg border border-stone-200 p-5 dark:border-stone-800">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">API key</h2>
        <span className="text-xs text-stone-500 dark:text-stone-400">
          Used by the Figma plugin, CLI, and GitHub Action
        </span>
      </header>

      {state.kind === "fresh" && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
          <p className="mb-2 font-medium text-amber-900 dark:text-amber-200">
            Copy this key now. We won&apos;t show it again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded border border-amber-200 bg-white px-2 py-1 font-mono text-xs text-stone-900 select-all dark:border-amber-800 dark:bg-stone-900 dark:text-stone-100">
              {state.rawKey}
            </code>
            <button
              type="button"
              onClick={() => copyKey(state.rawKey)}
              className="rounded-md border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-stone-900 dark:text-amber-200 dark:hover:bg-stone-800"
            >
              {copyState === "copied" ? "Copied" : "Copy"}
            </button>
          </div>
          {copyState === "failed" && (
            <p
              role="status"
              className="mt-2 text-xs text-amber-900 dark:text-amber-200"
            >
              Copy failed. Select the text above and copy it manually.
            </p>
          )}
        </div>
      )}

      {state.kind === "error" && (
        <div className="mb-4 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200">
          {state.message}
        </div>
      )}

      {hasKey ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <code className="rounded bg-stone-100 px-2 py-1 font-mono text-xs text-stone-700 dark:bg-stone-900 dark:text-stone-300">
              {prefix}…
            </code>
            {createdAt && (
              <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                Created {formatDate(createdAt)}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isLoading}
              onClick={rotate}
              className="rounded-md border border-stone-300 px-3 py-1.5 text-xs font-medium hover:bg-stone-50 disabled:opacity-50 dark:border-stone-700 dark:hover:bg-stone-900"
            >
              {isLoading && state.action === "rotate" ? "Rotating…" : "Rotate"}
            </button>
            <button
              type="button"
              disabled={isLoading}
              onClick={() => setConfirmingRevoke(true)}
              className="rounded-md border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950"
            >
              {isLoading && state.action === "revoke" ? "Revoking…" : "Revoke"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-stone-600 dark:text-stone-300">
            No active API key. Generate one to sign in from the Figma plugin
            or the CLI.
          </p>
          <button
            type="button"
            disabled={isLoading}
            onClick={rotate}
            className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50 dark:bg-emerald-400 dark:text-emerald-950 dark:hover:bg-emerald-300"
          >
            {isLoading ? "Generating…" : "Generate key"}
          </button>
        </div>
      )}

      <AlertDialog
        open={confirmingRevoke}
        title="Revoke this API key?"
        description="The Figma plugin and any CLI sessions using this key will stop working immediately. You'll need to generate a new key to sign in again."
        confirmLabel="Revoke key"
        cancelLabel="Keep key"
        tone="danger"
        onConfirm={revoke}
        onCancel={() => setConfirmingRevoke(false)}
      />
    </section>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
