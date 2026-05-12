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
import { Button } from "@/components/ui/button";

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
    <section className="rounded-lg border border-line p-5">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-strong">API key</h2>
        <span className="text-xs text-quiet">
          Used by the Figma plugin, CLI, and GitHub Action
        </span>
      </header>

      {state.kind === "fresh" && (
        <div className="mb-4 rounded-md border border-accent-caution-border bg-accent-caution-soft p-3 text-sm text-accent-caution-text">
          <p className="mb-2 font-medium">
            Copy this key now. We won&apos;t show it again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded border border-accent-caution-border bg-raised px-2 py-1 font-mono text-xs text-strong select-all">
              {state.rawKey}
            </code>
            <Button
              variant="warning"
              size="sm"
              onClick={() => copyKey(state.rawKey)}
            >
              {copyState === "copied" ? "Copied" : "Copy"}
            </Button>
          </div>
          {copyState === "failed" && (
            <p role="status" className="mt-2 text-xs">
              Copy failed. Select the text above and copy it manually.
            </p>
          )}
        </div>
      )}

      {state.kind === "error" && (
        <div className="mb-4 rounded-md border border-accent-concern-border bg-accent-concern-soft p-3 text-sm text-accent-concern-text">
          {state.message}
        </div>
      )}

      {hasKey ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <code className="rounded bg-raised px-2 py-1 font-mono text-xs text-default">
              {prefix}…
            </code>
            {createdAt && (
              <p className="mt-1 text-xs text-quiet">
                Created {formatDate(createdAt)}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={isLoading}
              onClick={rotate}
            >
              {isLoading && state.action === "rotate" ? "Rotating…" : "Rotate"}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={isLoading}
              onClick={() => setConfirmingRevoke(true)}
            >
              {isLoading && state.action === "revoke" ? "Revoking…" : "Revoke"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-default">
            No active API key. Generate one to sign in from the Figma plugin
            or the CLI.
          </p>
          <Button disabled={isLoading} onClick={rotate} size="sm">
            {isLoading ? "Generating…" : "Generate key"}
          </Button>
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
