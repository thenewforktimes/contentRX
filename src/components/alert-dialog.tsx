"use client";

/**
 * Accessible confirmation dialog. Replaces window.confirm() for destructive
 * actions so screen readers and keyboard users get a real focus-trapped modal
 * with a role="alertdialog", labelled title + description, and Escape to cancel.
 */

import { useEffect, useId, useRef } from "react";
import { buttonStyles } from "@/components/ui/button";

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
};

export function AlertDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  onConfirm,
  onCancel,
}: Props) {
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const previousActiveRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;

    const active = document.activeElement;
    previousActiveRef.current = active instanceof HTMLElement ? active : null;
    cancelBtnRef.current?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === "Tab") {
        const focusables = [cancelBtnRef.current, confirmBtnRef.current].filter(
          (el): el is HTMLButtonElement => el !== null,
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const current = document.activeElement;
        if (e.shiftKey) {
          if (current === first) {
            e.preventDefault();
            last.focus();
          }
        } else if (current === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousActiveRef.current?.focus();
    };
  }, [open, onCancel]);

  if (!open) return null;

  const confirmClass = buttonStyles({
    variant: tone === "danger" ? "danger" : "primary",
    size: "sm",
  });
  const cancelClass = buttonStyles({ variant: "secondary", size: "sm" });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="w-full max-w-sm rounded-lg border border-line bg-overlay p-5 shadow-lg"
      >
        <h2 id={titleId} className="mb-2 text-sm font-semibold text-strong">
          {title}
        </h2>
        <p id={descId} className="mb-4 text-sm text-quiet">
          {description}
        </p>
        <div className="flex justify-end gap-2">
          <button
            ref={cancelBtnRef}
            type="button"
            onClick={onCancel}
            className={cancelClass}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={onConfirm}
            className={confirmClass}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
