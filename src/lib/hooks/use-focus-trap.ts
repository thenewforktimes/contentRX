/**
 * useFocusTrap — accessibility hook for modal-style dialogs.
 *
 * Encapsulates the focus-management contract that WCAG 2.1.2 and
 * 2.4.3 require for modal dialogs:
 *
 *   1. Save the active element on open so we can restore focus on close
 *   2. Move initial focus into the dialog (to the first interactive
 *      element, or a caller-specified ref)
 *   3. Trap Tab / Shift+Tab inside the dialog — block focus from
 *      escaping to the page underneath
 *   4. Close on ESC
 *   5. Mark the rest of the page `inert` so assistive tech (screen
 *      reader virtual cursor, rotor, headings list) can't reach the
 *      background content while the dialog is open
 *   6. Reverse all of the above on close
 *
 * `src/components/alert-dialog.tsx` had a hand-rolled implementation
 * of this contract. The 2026-05-14 a11y audit found that
 * `finding-adjust-modal.tsx`, `flag-for-review.tsx`, and
 * `admin/command-palette.tsx` were partial implementations missing
 * the trap, the restore, or the background `inert`. Rather than
 * fixing each separately, this hook centralizes the contract so
 * every dialog gets the same treatment.
 *
 * Usage:
 *
 *   const dialogRef = useRef<HTMLDivElement>(null);
 *   useFocusTrap({
 *     active: isOpen,
 *     containerRef: dialogRef,
 *     onClose: () => setIsOpen(false),
 *     // optional — element to focus on open; defaults to first
 *     // interactive element in the container
 *     initialFocusRef: textareaRef,
 *   });
 *
 *   return isOpen ? (
 *     <div ref={dialogRef} role="dialog" aria-modal="true">...</div>
 *   ) : null;
 *
 * The `inert` attribute is set on every sibling of the container's
 * portal root (or `document.body`'s direct children outside the
 * container's lineage) — anything that isn't the modal becomes
 * non-interactive AND hidden from assistive tech.
 */

import { useEffect, type RefObject } from "react";

interface UseFocusTrapOptions {
  /** True when the dialog is open. The hook is a no-op when false. */
  active: boolean;
  /** Ref to the modal container — the element whose interactive
   * descendants form the focus-trap loop. */
  containerRef: RefObject<HTMLElement | null>;
  /** Called when ESC is pressed. */
  onClose: () => void;
  /** Element to focus on open. Default: first interactive element
   * inside `containerRef`. Pass a ref to a textarea or input to land
   * the user on the primary task. */
  initialFocusRef?: RefObject<HTMLElement | null>;
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function useFocusTrap({
  active,
  containerRef,
  onClose,
  initialFocusRef,
}: UseFocusTrapOptions): void {
  useEffect(() => {
    if (!active) return;

    // 1. Save what had focus before the dialog opened. On close we
    //    return focus here so keyboard users don't lose place.
    const previousActive = document.activeElement as HTMLElement | null;

    const container = containerRef.current;
    if (!container) return;

    // 2. Move initial focus. If the caller provided a target ref,
    //    honor it; otherwise pick the first interactive element in
    //    the container; otherwise focus the container itself (with
    //    tabIndex=-1 — the container is responsible for setting that
    //    if it expects to receive focus).
    const focusTarget =
      initialFocusRef?.current ??
      (container.querySelector(FOCUSABLE_SELECTOR) as HTMLElement | null) ??
      container;
    focusTarget.focus();

    // 3. Mark every sibling of the modal as `inert` so AT can't reach
    //    them via virtual cursor / rotor / heading-list. The `inert`
    //    HTML attribute is well-supported in modern browsers (Chrome
    //    102+, Firefox 112+, Safari 15.5+). It also makes the marked
    //    subtree non-interactive (Tab skips it, click does nothing).
    //
    //    We mark body's direct children that are NOT ancestors of the
    //    container. That way an underlying page region becomes inert,
    //    but the path-from-body-to-modal stays interactive.
    const inertedElements: HTMLElement[] = [];
    const isAncestorOfContainer = (el: HTMLElement) => el.contains(container);
    Array.from(document.body.children).forEach((child) => {
      if (!(child instanceof HTMLElement)) return;
      if (isAncestorOfContainer(child)) return;
      if (child.contains(container)) return;
      // Skip elements already inert (e.g., nested dialogs).
      if (child.hasAttribute("inert")) return;
      child.setAttribute("inert", "");
      inertedElements.push(child);
    });

    // 4. Trap Tab inside the container. Listen on document so the
    //    handler still fires when focus has somehow escaped (e.g., a
    //    click on the backdrop pulled focus to <body>).
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const focusables = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);

      if (focusables.length === 0) {
        // No interactive elements; keep focus on the container.
        e.preventDefault();
        container.focus();
        return;
      }

      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const activeEl = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        // Shift+Tab from the first → wrap to last.
        if (activeEl === first || !container.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab from the last → wrap to first.
        if (activeEl === last || !container.contains(activeEl)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      // 5. Tear down: remove inert, remove the keydown listener,
      //    restore focus to whatever had it before the dialog opened.
      document.removeEventListener("keydown", handleKeyDown);
      inertedElements.forEach((el) => el.removeAttribute("inert"));
      // Restore focus on a microtask so React's unmount finishes
      // first. If the previous element is gone (e.g., removed by a
      // server action that re-rendered), fall back to body.
      queueMicrotask(() => {
        if (previousActive && document.contains(previousActive)) {
          previousActive.focus();
        }
      });
    };
  }, [active, containerRef, onClose, initialFocusRef]);
}
