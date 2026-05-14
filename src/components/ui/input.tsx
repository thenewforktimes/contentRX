/**
 * Input / Textarea / Select / Label / FieldError — token-based form
 * primitives.
 *
 * Replaces the ~30 inline `border border-stone-300 bg-white ...
 * dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 focus:...`
 * patterns scattered across the dashboard. Every form across the app
 * gets the same border, focus ring, and disabled treatment from one
 * place.
 *
 * Each primitive is a thin wrapper around its native element so all
 * standard HTML attributes (name, value, onChange, required, pattern,
 * etc.) flow through unchanged.
 *
 * 2026-05-14 a11y pass — three additions:
 *
 *   1. `min-h-[44px]` on every input meets WCAG 2.5.5 / 2.5.8 touch-
 *      target thresholds. Without it, `text-sm` + small padding
 *      produced ~36px inputs — fine on desktop, painful for motor-
 *      impaired users on mobile.
 *
 *   2. New `<Label>` primitive. Most forms already use bare `<label
 *      htmlFor>` but the markup is inconsistent. This wraps the
 *      pattern and adds an optional "required" mark.
 *
 *   3. New `error?` + `helperText?` props on `<Input>` / `<Textarea>`
 *      / `<Select>` auto-render the message and wire `aria-invalid` +
 *      `aria-describedby` so the field announces "Invalid: <message>"
 *      to screen readers without callers re-deriving the pattern.
 *
 * Focus ring uses --ring-focus — passes WCAG 1.4.11 (3:1 vs every
 * adjacent surface) per PR 1's AAA-tuning pass.
 */

import { useId } from "react";
import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

// Base styles shared by Input / Textarea / Select. `min-h-[44px]`
// satisfies WCAG 2.5.5 even when `py-2 text-sm` would otherwise
// produce a ~36px element.
const inputBase =
  "block w-full rounded-md border border-line bg-raised px-3 py-2 text-sm text-strong placeholder:text-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-50";
const inputSizing = "min-h-[44px]";

// When the field is in error state, the border lifts to the concern
// border token. Visual cue alongside the screen-reader cue.
const inputErrorRing =
  "border-accent-concern-border focus-visible:ring-accent-concern-border";

interface FieldA11yProps {
  /** Inline error message rendered below the field. When present:
   *  the field is marked `aria-invalid`, the error message is paired
   *  via `aria-describedby`, and the error text gets `role="alert"`
   *  so screen readers announce it. */
  error?: string;
  /** Optional supporting text rendered below the field. Paired via
   *  `aria-describedby` when present (alongside the error, if any). */
  helperText?: string;
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & FieldA11yProps;
type TextareaProps =
  TextareaHTMLAttributes<HTMLTextAreaElement> & FieldA11yProps;
type SelectProps = SelectHTMLAttributes<HTMLSelectElement> &
  FieldA11yProps & { children: ReactNode };

/**
 * Build the aria-describedby string from the field's own id + the
 * helper/error ids. Returns undefined when there's nothing to describe
 * so we don't render an empty attribute.
 */
function buildDescribedBy(
  fieldId: string | undefined,
  helperText: string | undefined,
  error: string | undefined,
): string | undefined {
  if (!fieldId) return undefined;
  const ids: string[] = [];
  if (helperText) ids.push(`${fieldId}-helper`);
  if (error) ids.push(`${fieldId}-error`);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

export function Input({
  className = "",
  error,
  helperText,
  id: idProp,
  ...props
}: InputProps) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const describedBy = buildDescribedBy(id, helperText, error);
  return (
    <>
      <input
        {...props}
        id={id}
        aria-invalid={error ? true : props["aria-invalid"]}
        aria-describedby={describedBy}
        className={[
          inputBase,
          inputSizing,
          error ? inputErrorRing : "",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      />
      <FieldMessages
        fieldId={id}
        helperText={helperText}
        error={error}
      />
    </>
  );
}

export function Textarea({
  className = "",
  error,
  helperText,
  id: idProp,
  ...props
}: TextareaProps) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const describedBy = buildDescribedBy(id, helperText, error);
  return (
    <>
      <textarea
        {...props}
        id={id}
        aria-invalid={error ? true : props["aria-invalid"]}
        aria-describedby={describedBy}
        // No min-h on textarea — the `rows` prop controls height and
        // textareas are typically tall enough that the 44px floor
        // doesn't apply.
        className={[
          inputBase,
          "leading-relaxed",
          error ? inputErrorRing : "",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      />
      <FieldMessages
        fieldId={id}
        helperText={helperText}
        error={error}
      />
    </>
  );
}

export function Select({
  className = "",
  children,
  error,
  helperText,
  id: idProp,
  ...props
}: SelectProps) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const describedBy = buildDescribedBy(id, helperText, error);
  return (
    <>
      <select
        {...props}
        id={id}
        aria-invalid={error ? true : props["aria-invalid"]}
        aria-describedby={describedBy}
        className={[
          inputBase,
          inputSizing,
          error ? inputErrorRing : "",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </select>
      <FieldMessages
        fieldId={id}
        helperText={helperText}
        error={error}
      />
    </>
  );
}

/**
 * Helper that renders the helper + error messages with the right ids
 * and ARIA roles. Kept as an internal component (not exported) so the
 * Input/Textarea/Select trio is the single API callers reach for.
 */
function FieldMessages({
  fieldId,
  helperText,
  error,
}: {
  fieldId: string;
  helperText: string | undefined;
  error: string | undefined;
}) {
  if (!helperText && !error) return null;
  return (
    <>
      {helperText && (
        <p
          id={`${fieldId}-helper`}
          className="mt-1 text-xs text-quiet"
        >
          {helperText}
        </p>
      )}
      {error && (
        <p
          id={`${fieldId}-error`}
          role="alert"
          className="mt-1 text-xs text-accent-concern-text"
        >
          {error}
        </p>
      )}
    </>
  );
}

/**
 * `<Label>` — paired with an Input via `htmlFor` ↔ input `id`.
 *
 * Pass `required` to render a visually-hidden "(required)" suffix
 * for screen readers plus an asterisk for sighted users. The
 * underlying input should ALSO carry the `required` HTML attribute;
 * the visual + AT cue here is the labelling counterpart.
 */
export function Label({
  required,
  children,
  className = "",
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return (
    <label
      {...props}
      className={[
        "block text-sm font-medium text-default",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
      {required && (
        <>
          <span aria-hidden="true" className="ml-0.5 text-accent-concern-text">
            *
          </span>
          <span className="sr-only"> (required)</span>
        </>
      )}
    </label>
  );
}
