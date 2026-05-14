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

import { forwardRef, useId } from "react";
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
//
// 2026-05-14 updates from the affordance audit:
//   - hover:border-line-strong  → mouse users now see a hover cue
//     (previously the border was static until focus — no indication
//     that the field was interactive).
//   - disabled:bg-disabled etc. → token-driven disabled state
//     replaces the previous opacity-50. Same finding as Button:
//     opacity-50 on a placeholder reads as "this field is slightly
//     faded" rather than "this is locked." The neutral disabled
//     palette communicates lock-state unambiguously.
const inputBase =
  "block w-full rounded-md border border-line bg-raised px-3 py-2 text-sm text-strong placeholder:text-quiet transition-colors hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:border-disabled disabled:bg-disabled disabled:text-disabled-on disabled:placeholder:text-disabled-on disabled:hover:border-disabled";
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

// forwardRef so callers can keep a ref for focus management (e.g. the
// flag-for-review consent modal moves initial focus to the textarea
// via useFocusTrap).
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { className = "", error, helperText, id: idProp, ...props },
    ref,
  ) {
    const generatedId = useId();
    const id = idProp ?? generatedId;
    const describedBy = buildDescribedBy(id, helperText, error);
    return (
      <>
        <textarea
          {...props}
          ref={ref}
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
  },
);

// forwardRef so callers can hold a ref for focus management (e.g. the
// finding-adjust-modal moves initial focus to the Reason <select>).
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select(
    { className = "", children, error, helperText, id: idProp, ...props },
    ref,
  ) {
    const generatedId = useId();
    const id = idProp ?? generatedId;
    const describedBy = buildDescribedBy(id, helperText, error);
    return (
      <>
        <select
          {...props}
          ref={ref}
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
  },
);

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

/**
 * `<Checkbox>` and `<Radio>` — control primitives with full state
 * coverage (resting / hover / focus-visible / checked / disabled).
 *
 * Three raw `<input type="checkbox">` callers shipped before this
 * primitive existed (flag-for-review consent, rules-client custom-rule
 * case-insensitive flag, subscription-panel auto-renewal consent).
 * Browser defaults have inconsistent `:focus` and `:checked` styling
 * across Safari / Firefox / Chrome, and a default tick on tinted
 * backgrounds can fail WCAG 1.4.11 (3:1 vs adjacent surface). The
 * primitive paints a consistent visual via `accent-color` (where
 * supported) plus an explicit design-system focus ring.
 *
 * Touch target sized at 18px control + label hit area; the label
 * extends the clickable region per HTML's native checkbox-label
 * pairing. WCAG 2.5.5 satisfied via the label-extended hit area, not
 * the bare control — matches MDN guidance for native form controls.
 */
type ToggleControlProps = InputHTMLAttributes<HTMLInputElement> & {
  /** Visible label rendered to the right of the control. Forms the
   *  primary text the user reads + clicks. */
  label: ReactNode;
  /** Optional supporting helper text rendered under the label. */
  helperText?: string;
  /** Mark the field with the asterisk + sr-only "(required)" cue
   *  that mirrors `<Label required>`. The underlying input should
   *  ALSO carry the `required` HTML attribute. */
  requiredMark?: boolean;
};

const controlBase =
  "h-[18px] w-[18px] shrink-0 rounded border border-line-strong bg-raised accent-accent-primary transition-colors hover:border-accent-primary-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-raised disabled:cursor-not-allowed disabled:opacity-50";

export function Checkbox({
  label,
  helperText,
  requiredMark,
  id: idProp,
  className = "",
  ...props
}: ToggleControlProps) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const helperId = helperText ? `${id}-helper` : undefined;
  return (
    <div className={`flex items-start gap-2 text-sm ${className}`}>
      <input
        type="checkbox"
        {...props}
        id={id}
        aria-describedby={helperId}
        className={controlBase}
      />
      <div className="flex flex-col gap-1">
        <label
          htmlFor={id}
          className="cursor-pointer text-default"
        >
          {label}
          {requiredMark && (
            <>
              <span
                aria-hidden="true"
                className="ml-0.5 text-accent-concern-text"
              >
                *
              </span>
              <span className="sr-only"> (required)</span>
            </>
          )}
        </label>
        {helperText && (
          <p id={helperId} className="text-xs text-quiet">
            {helperText}
          </p>
        )}
      </div>
    </div>
  );
}

export function Radio({
  label,
  helperText,
  requiredMark,
  id: idProp,
  className = "",
  ...props
}: ToggleControlProps) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const helperId = helperText ? `${id}-helper` : undefined;
  return (
    <div className={`flex items-start gap-2 text-sm ${className}`}>
      <input
        type="radio"
        {...props}
        id={id}
        aria-describedby={helperId}
        // rounded-full overrides the rounded-md from controlBase.
        className={`${controlBase} rounded-full`}
      />
      <div className="flex flex-col gap-1">
        <label
          htmlFor={id}
          className="cursor-pointer text-default"
        >
          {label}
          {requiredMark && (
            <>
              <span
                aria-hidden="true"
                className="ml-0.5 text-accent-concern-text"
              >
                *
              </span>
              <span className="sr-only"> (required)</span>
            </>
          )}
        </label>
        {helperText && (
          <p id={helperId} className="text-xs text-quiet">
            {helperText}
          </p>
        )}
      </div>
    </div>
  );
}
