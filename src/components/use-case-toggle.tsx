"use client";

/**
 * UseCaseToggle — landing-page client component that lets a visitor
 * flip between four kinds of writing the engine handles. The narrative
 * is "same engine, four kinds of writing" — two short-form (button
 * label, error message) and two long-form (product update, security
 * disclosure). It tells the long-form story without a separate
 * landing-page section.
 *
 * Substrate boundary (ADR 2026-04-25): customer-readable terms only.
 * Each example surfaces the moment + content-type as friendly labels,
 * never the engine's snake_case enum and never `standard_id` /
 * `rule_version`.
 *
 * Tabbed pattern: WAI-ARIA Tabs, single panel rendered for the active
 * id. Tabs are ordinary buttons (no roving tab-index) because the
 * panel renders synchronously on click; no keyboard trap to design
 * around.
 */
import Link from "next/link";
import { useState } from "react";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";

type UseCase = {
  id: "button" | "error" | "product-update" | "security-disclosure";
  label: string;
  momentLabel: string;
  contentTypeLabel: string;
  /** Whether the writer's draft is short-form (UI string) or long-form
   * (paragraph). Drives a tiny visual hint on the tab so the breadth
   * of the engine reads at a glance. */
  shape: "Short-form" | "Long-form";
  inputText: string;
  flag: {
    severity: "high" | "medium" | "low";
    severityLabel: string;
    issue: string;
    suggestion: string;
    category: string;
  };
};

const USE_CASES: readonly UseCase[] = [
  {
    id: "button",
    label: "Button label",
    momentLabel: "Destructive action",
    contentTypeLabel: "Button",
    shape: "Short-form",
    inputText: "Submit",
    flag: {
      severity: "medium",
      severityLabel: "Worth adjusting",
      category: "Action verbs",
      issue:
        "The button doesn't name what happens. 'Submit' is a form ceremony, not an outcome.",
      suggestion: "Send invites",
    },
  },
  {
    id: "error",
    label: "Error message",
    momentLabel: "Error recovery",
    contentTypeLabel: "Error message",
    shape: "Short-form",
    inputText: "An unexpected error occurred.",
    flag: {
      severity: "high",
      severityLabel: "Worth adjusting",
      category: "Voice & tone",
      issue:
        "This error doesn't say what went wrong or what to do next.",
      suggestion:
        "We couldn't load your dashboard. Try again. If it keeps happening, email hello@contentrx.io.",
    },
  },
  {
    id: "product-update",
    label: "Product update email",
    momentLabel: "Customer notification",
    contentTypeLabel: "Long-form",
    shape: "Long-form",
    inputText:
      "We're absolutely thrilled to announce our newest feature, advanced moment classification. This robust capability leverages cutting-edge AI to facilitate your team's ability to optimize content workflows. We can't wait to see how you'll utilize these world-class enhancements!",
    flag: {
      severity: "medium",
      severityLabel: "Worth adjusting",
      category: "Plain language",
      issue:
        "Eight corporate words in three sentences (robust, leverages, facilitate, optimize, utilize, world-class, cutting-edge, empowering). The reader translates the announcement before they read it.",
      suggestion:
        "Replace with plain words. 'Use' beats 'utilize'; 'help' beats 'facilitate'; 'improve' beats 'optimize'.",
    },
  },
  {
    id: "security-disclosure",
    label: "Security disclosure",
    momentLabel: "Compliance disclosure",
    contentTypeLabel: "Long-form",
    shape: "Long-form",
    inputText:
      "On April 12, 2026, our security team became aware of a potential vulnerability that may have impacted some users. We have since taken comprehensive steps to mitigate this issue and ensure the integrity of our platform. We sincerely apologize for any inconvenience.",
    flag: {
      severity: "high",
      severityLabel: "Worth adjusting",
      category: "Voice & tone",
      issue:
        "The reader doesn't know what was exposed, who was affected, or what to do. A disclosure has to name those three things or it isn't a disclosure.",
      suggestion:
        "On April 12, 2026, an attacker accessed email addresses for 1,200 accounts. No passwords or content were exposed. We rotated affected sessions and emailed every affected user.",
    },
  },
] as const;

function severityTone(
  severity: UseCase["flag"]["severity"],
): "amber" | "stone" {
  return severity === "low" ? "stone" : "amber";
}

export function UseCaseToggle() {
  const [activeId, setActiveId] = useState<UseCase["id"]>(USE_CASES[0].id);
  const active = USE_CASES.find((c) => c.id === activeId) ?? USE_CASES[0];

  return (
    <div className="rounded-3xl border border-line bg-raised/40 p-6 sm:p-10">
      <Eyebrow>Same engine, every kind of writing</Eyebrow>
      <h2 className="mt-2 text-2xl font-semibold text-strong sm:text-3xl">
        One content model. Four kinds of writing.
      </h2>
      <p className="mt-4 max-w-2xl text-base text-default">
        ContentRX reads a button label, an error message, a product
        update email, and a security disclosure with the same
        content-design judgment. Pick a use case to see what the
        engine flagged.
      </p>

      <div
        role="tablist"
        aria-label="Use cases"
        className="mt-6 flex flex-wrap gap-2"
      >
        {USE_CASES.map((uc) => {
          const isActive = uc.id === activeId;
          return (
            <button
              key={uc.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`use-case-panel-${uc.id}`}
              id={`use-case-tab-${uc.id}`}
              onClick={() => setActiveId(uc.id)}
              className={
                isActive
                  ? "inline-flex items-center gap-2 rounded-md border border-accent-affirm-border bg-accent-affirm-soft px-3 py-1.5 text-sm font-medium text-accent-affirm-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  : "inline-flex items-center gap-2 rounded-md border border-line bg-canvas px-3 py-1.5 text-sm font-medium text-default transition hover:border-line-strong hover:text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              }
            >
              <span>{uc.label}</span>
              <span className="text-[10px] font-medium uppercase tracking-wider text-quiet">
                {uc.shape}
              </span>
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`use-case-panel-${active.id}`}
        aria-labelledby={`use-case-tab-${active.id}`}
        className="mt-6 rounded-xl border border-line bg-canvas p-5 sm:p-6"
      >
        <div className="flex flex-wrap gap-2">
          <Pill tone="stone" size="xs">
            Moment: {active.momentLabel}
          </Pill>
          <Pill tone="stone" size="xs">
            {active.contentTypeLabel}
          </Pill>
        </div>

        <p className="mt-5 text-[10px] font-semibold uppercase tracking-wider text-quiet">
          What you wrote
        </p>
        <p
          className={
            active.shape === "Short-form"
              ? "mt-2 font-mono text-sm text-strong"
              : "mt-2 text-sm text-strong"
          }
        >
          {active.inputText}
        </p>

        <div className="mt-5 rounded-lg border border-line bg-raised p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <Pill tone={severityTone(active.flag.severity)} size="xs">
              {active.flag.severityLabel}
            </Pill>
            <span className="text-[10px] font-medium uppercase tracking-wider text-quiet">
              ✦ AI
            </span>
            <span className="ml-auto text-[10px] font-medium uppercase tracking-wider text-quiet">
              {active.flag.category}
            </span>
          </div>
          <p className="mt-3 text-sm font-medium text-strong">
            {active.flag.issue}
          </p>
          <div className="mt-3 rounded-md bg-sunken p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-quiet">
              Suggested
            </p>
            <p className="mt-1 text-sm text-default">
              {active.flag.suggestion}
            </p>
          </div>
        </div>
      </div>

      <p className="mt-6 text-sm text-quiet">
        See longer-form examples in the{" "}
        <Link
          href="/writes"
          className="underline underline-offset-2 hover:text-default"
        >
          long-form gallery
        </Link>
        .
      </p>
    </div>
  );
}
