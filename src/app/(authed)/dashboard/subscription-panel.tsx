"use client";

/**
 * Subscription panel — Free users get a plan picker (Pro/Team ×
 * Monthly/Annual); paid users get a summary + "Manage in Stripe" link.
 *
 * The Upgrade button POSTs to /api/checkout and then redirects the
 * browser to the Stripe-hosted Checkout URL. Success brings the user
 * back to /dashboard?upgraded=1; the webhook does the DB writes.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input } from "@/components/ui/input";
import { Pill, type PillTone } from "@/components/ui/pill";
import type { Plan } from "@/lib/quotas";

// Hosts we will redirect the browser to. Any `url` field returned by
// /api/checkout or /api/portal must resolve to one of these before we
// set window.location.href — guards against an open-redirect vuln if a
// future refactor changes what the API returns (UI-H-01 from
// 2026-04-22 audit).
const STRIPE_REDIRECT_HOSTS = new Set<string>([
  "checkout.stripe.com",
  "billing.stripe.com",
]);

function safeStripeRedirect(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new Error("Stripe didn't return a URL. Try again in a moment.");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Got a malformed Stripe URL. Try again.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Stripe URL must be https.");
  }
  if (!STRIPE_REDIRECT_HOSTS.has(parsed.host)) {
    throw new Error(`Unexpected redirect host: ${parsed.host}`);
  }
  return parsed.toString();
}

type Props = {
  plan: Plan;
  seats: number;
  currentPeriodEnd: string | null;
  subscriptionStatus: string | null;
  /** True between the moment the customer clicks Cancel in the Stripe
   *  Portal and the moment the paid period ends. Stripe keeps `status`
   *  on "active" through that grace window, so we need the separate
   *  flag to render the right copy ("Ends" not "Renews"). */
  cancelAtPeriodEnd: boolean;
  /** Signed-nonce CARL consent token minted server-side when the
   *  page rendered for a free user. Forwarded into the /api/checkout
   *  POST body. Null for non-free users (they never see the upgrade
   *  checkbox). See src/lib/consent-token.ts for the protocol. */
  consentToken: string | null;
};

type Interval = "monthly" | "annual";

// Single source of truth in src/lib/billing-constants.ts so server
// (stripe.ts, checkout/route.ts) and client (this panel) can't drift.
import { TEAM_MIN_SEATS } from "@/lib/billing-constants";

export function SubscriptionPanel({
  plan,
  seats,
  currentPeriodEnd,
  subscriptionStatus,
  cancelAtPeriodEnd,
  consentToken,
}: Props) {
  if (plan === "free") {
    return <UpgradeCard consentToken={consentToken} />;
  }
  return (
    <PaidCard
      plan={plan}
      seats={seats}
      currentPeriodEnd={currentPeriodEnd}
      subscriptionStatus={subscriptionStatus}
      cancelAtPeriodEnd={cancelAtPeriodEnd}
    />
  );
}

function UpgradeCard({ consentToken }: { consentToken: string | null }) {
  const [selectedPlan, setSelectedPlan] = useState<"pro" | "team">("pro");
  const [interval, setInterval] = useState<Interval>("monthly");
  const [seats, setSeats] = useState(TEAM_MIN_SEATS);
  // California Automatic Renewal Law (CARL / AB 2863, 2025-07-01)
  // requires affirmative consent to auto-renewal that is separate
  // from agreement to the Terms of Service. The checkbox below MUST
  // remain a distinct affirmation — combining it with the ToS
  // checkbox or a "Continue" CTA defeats CARL's intent.
  const [autoRenewalConsented, setAutoRenewalConsented] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!autoRenewalConsented) {
      setError(
        "Please confirm you agree to automatic renewal before continuing.",
      );
      return;
    }
    if (!consentToken) {
      // Shouldn't happen — free users always get a token from
      // the server render. If somehow it's missing, fail safe
      // with a refresh prompt rather than POSTing a body the
      // server is going to reject anyway.
      setError(
        "We couldn't initialise the consent token. Refresh the page and try again.",
      );
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: selectedPlan,
          interval,
          ...(selectedPlan === "team" ? { seats } : {}),
          // Signed-nonce CARL consent token. /api/checkout verifies
          // the signature, time window, user-binding, and replay
          // state before stamping consent. See
          // src/lib/consent-token.ts.
          consentToken,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          body?.error ?? "Couldn't start checkout. Try again. If it keeps happening, email hello@contentrx.io.",
        );
      }
      const { url } = await res.json();
      window.location.href = safeStripeRedirect(url);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't start checkout. Try again. If it keeps happening, email hello@contentrx.io.",
      );
      setLoading(false);
    }
  }

  return (
    <section className="rounded-lg border border-line p-5">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-strong">Upgrade</h2>
        <span className="text-xs text-quiet">
          Billed monthly or annually. Cancel anytime.
        </span>
      </header>

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <PlanOption
          name="Pro"
          price={interval === "monthly" ? "$39/mo" : "$379/yr"}
          description="1,000 checks per month. For solo designers and small teams."
          selected={selectedPlan === "pro"}
          onSelect={() => setSelectedPlan("pro")}
        />
        <PlanOption
          name="Team"
          price={
            interval === "monthly" ? "$79/seat/mo" : "$759/seat/yr"
          }
          description="2,000 checks per seat, pooled across the team."
          selected={selectedPlan === "team"}
          onSelect={() => setSelectedPlan("team")}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <IntervalToggle value={interval} onChange={setInterval} />
        {selectedPlan === "team" && (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-default">Seats</span>
            <Input
              type="number"
              min={TEAM_MIN_SEATS}
              max={500}
              value={seats}
              onChange={(e) =>
                setSeats(Math.max(TEAM_MIN_SEATS, Number(e.target.value) || TEAM_MIN_SEATS))
              }
              className="w-20"
            />
          </label>
        )}
      </div>

      {/* CARL-compliant auto-renewal consent. Separate from any ToS
          checkbox at signup. Plain language, names the cadence, and
          points at the Stripe Portal as the cancellation path.
          Migrated to the Checkbox primitive on 2026-05-14 so it picks
          up the design-system focus ring + AAA hover border. Previous
          raw <input type="checkbox"> shipped browser defaults — bad
          fit for a load-bearing CARL-compliance gate. */}
      <div className="mb-3 rounded-md border border-line bg-canvas p-3">
        <Checkbox
          checked={autoRenewalConsented}
          onChange={(e) => setAutoRenewalConsented(e.target.checked)}
          required
          requiredMark
          label={
            <span className="text-xs">
              I agree that my subscription will renew automatically{" "}
              {interval === "monthly" ? "every month" : "every year"}{" "}
              at the price shown above. I can cancel anytime from the
              dashboard, and access continues through the end of the
              paid period.
            </span>
          }
        />
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-accent-concern-border bg-accent-concern-soft p-3 text-xs text-accent-concern-text">
          {error}
        </div>
      )}

      <Button
        onClick={submit}
        disabled={loading || !autoRenewalConsented}
      >
        {loading ? "Redirecting to Stripe…" : "Continue to checkout"}
      </Button>
    </section>
  );
}

function PaidCard({
  plan,
  seats,
  currentPeriodEnd,
  subscriptionStatus,
  cancelAtPeriodEnd,
}: {
  // Scale is sales-assisted at launch (no Stripe Checkout), so a Scale
  // user lands here only via founder-side provisioning. The label
  // mapping below renders "Scale" for that case; everything else stays
  // a Pro-or-Team flow.
  plan: "pro" | "scale" | "team";
  seats: number;
  currentPeriodEnd: string | null;
  subscriptionStatus: string | null;
  cancelAtPeriodEnd: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openPortal() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/portal", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          body?.error ?? "Couldn't open the billing portal. Try again. If it keeps happening, email hello@contentrx.io.",
        );
      }
      const { url } = await res.json();
      window.location.href = safeStripeRedirect(url);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't open the billing portal. Try again. If it keeps happening, email hello@contentrx.io.",
      );
      setLoading(false);
    }
  }

  const planLabel =
    plan === "pro"
      ? "Pro"
      : plan === "scale"
        ? "Scale"
        : `Team (${seats} seats)`;
  const visibleStatus =
    subscriptionStatus !== null && subscriptionStatus !== "active"
      ? subscriptionStatus
      : null;

  return (
    <section className="rounded-lg border border-line p-5">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-strong">Subscription</h2>
        <span className="text-xs text-quiet">
          Billing handled by Stripe
        </span>
      </header>
      <p className="mb-1 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{planLabel}</span>
        {visibleStatus && (
          <Pill tone={statusTone(visibleStatus)}>
            {humanizeStatus(visibleStatus)}
          </Pill>
        )}
        {cancelAtPeriodEnd && (
          <Pill tone="amber">Scheduled to cancel</Pill>
        )}
      </p>
      {currentPeriodEnd && (
        <p className="mb-3 text-xs text-quiet">
          {cancelAtPeriodEnd
            ? `Access ends ${formatDate(currentPeriodEnd)}. No further charges.`
            : `Renews ${formatDate(currentPeriodEnd)}`}
        </p>
      )}
      {error && (
        <div className="mb-3 rounded-md border border-accent-concern-border bg-accent-concern-soft p-3 text-xs text-accent-concern-text">
          {error}
        </div>
      )}
      <Button
        variant="secondary"
        size="sm"
        onClick={openPortal}
        disabled={loading}
      >
        {loading ? "Redirecting to Stripe…" : "Manage subscription"}
      </Button>
    </section>
  );
}

function PlanOption({
  name,
  price,
  description,
  selected,
  onSelect,
}: {
  name: string;
  price: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex flex-col rounded-md border p-3 text-left transition ${
        selected
          ? "border-accent-primary-border bg-sunken"
          : "border-line hover:border-line-strong"
      }`}
    >
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm font-semibold">{name}</span>
        <span className="text-xs text-quiet">{price}</span>
      </div>
      <p className="text-xs text-default">
        {description}
      </p>
    </button>
  );
}

function IntervalToggle({
  value,
  onChange,
}: {
  value: Interval;
  onChange: (next: Interval) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Billing interval"
      className="inline-flex rounded-md border border-line p-0.5"
    >
      {(["monthly", "annual"] as Interval[]).map((opt) => (
        <button
          type="button"
          role="radio"
          aria-checked={value === opt}
          key={opt}
          onClick={() => onChange(opt)}
          className={`rounded-[5px] px-3 py-1 text-xs font-medium transition ${
            value === opt
              ? "bg-strong text-canvas"
              : "text-quiet hover:text-strong"
          }`}
        >
          {opt === "monthly" ? "Monthly" : "Annual"}
        </button>
      ))}
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Translate Stripe lifecycle statuses into something a customer can read.
// Anything not listed falls back to a Title Cased version of the raw status.
function humanizeStatus(status: string): string {
  switch (status) {
    case "trialing":
      return "Trialing";
    case "past_due":
      return "Payment past due. Update your card to keep access";
    case "incomplete":
      return "Setup incomplete";
    case "incomplete_expired":
      return "Setup expired";
    case "canceled":
      return "Canceled";
    case "unpaid":
      return "Unpaid";
    case "paused":
      return "Paused";
    default:
      return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

// Map Stripe lifecycle status to a Pill tone. Trialing reads as "worth
// a look" (amber); anything in failed-payment territory is red; the
// rest fall back to neutral.
function statusTone(status: string): PillTone {
  switch (status) {
    case "trialing":
      return "amber";
    case "past_due":
    case "unpaid":
    case "incomplete_expired":
      return "red";
    default:
      return "neutral";
  }
}
