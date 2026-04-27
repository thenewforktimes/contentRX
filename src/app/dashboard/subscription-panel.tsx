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
};

type Interval = "monthly" | "annual";

const TEAM_MIN_SEATS = 3;

export function SubscriptionPanel({
  plan,
  seats,
  currentPeriodEnd,
  subscriptionStatus,
}: Props) {
  if (plan === "free") {
    return <UpgradeCard />;
  }
  return (
    <PaidCard
      plan={plan}
      seats={seats}
      currentPeriodEnd={currentPeriodEnd}
      subscriptionStatus={subscriptionStatus}
    />
  );
}

function UpgradeCard() {
  const [selectedPlan, setSelectedPlan] = useState<"pro" | "team">("pro");
  const [interval, setInterval] = useState<Interval>("monthly");
  const [seats, setSeats] = useState(TEAM_MIN_SEATS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
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
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Checkout failed");
      }
      const { url } = await res.json();
      window.location.href = safeStripeRedirect(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
      setLoading(false);
    }
  }

  return (
    <section className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Upgrade</h2>
        <span className="text-xs text-neutral-500">
          Billed monthly or annually. Cancel anytime.
        </span>
      </header>

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <PlanOption
          name="Pro"
          price={interval === "monthly" ? "$24/mo" : "$18/mo billed annually"}
          description="5,000 checks per month. For solo designers and small teams."
          selected={selectedPlan === "pro"}
          onSelect={() => setSelectedPlan("pro")}
        />
        <PlanOption
          name="Team"
          price={
            interval === "monthly"
              ? "$35/seat/mo"
              : "$29/seat/mo billed annually"
          }
          description={`${TEAM_MIN_SEATS}-seat minimum. 5,000 checks per seat. Shared rule overrides (coming).`}
          selected={selectedPlan === "team"}
          onSelect={() => setSelectedPlan("team")}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <IntervalToggle value={interval} onChange={setInterval} />
        {selectedPlan === "team" && (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-neutral-600 dark:text-neutral-400">Seats</span>
            <input
              type="number"
              min={TEAM_MIN_SEATS}
              max={500}
              value={seats}
              onChange={(e) =>
                setSeats(Math.max(TEAM_MIN_SEATS, Number(e.target.value) || TEAM_MIN_SEATS))
              }
              className="w-20 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={loading}
        className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {loading ? "Opening Stripe Checkout…" : "Continue to checkout"}
      </button>
    </section>
  );
}

function PaidCard({
  plan,
  seats,
  currentPeriodEnd,
  subscriptionStatus,
}: {
  plan: "pro" | "team";
  seats: number;
  currentPeriodEnd: string | null;
  subscriptionStatus: string | null;
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
        throw new Error(body?.error ?? "Portal failed");
      }
      const { url } = await res.json();
      window.location.href = safeStripeRedirect(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Portal failed");
      setLoading(false);
    }
  }

  const planLabel = plan === "pro" ? "Pro" : `Team (${seats} seats)`;
  const statusLabel =
    subscriptionStatus && subscriptionStatus !== "active"
      ? ` · ${subscriptionStatus}`
      : "";

  return (
    <section className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Subscription</h2>
        <span className="text-xs text-neutral-500">
          Billing handled by Stripe
        </span>
      </header>
      <p className="mb-1 text-sm">
        <span className="font-medium">{planLabel}</span>
        <span className="text-neutral-500">{statusLabel}</span>
      </p>
      {currentPeriodEnd && (
        <p className="mb-3 text-xs text-neutral-500">
          Renews {formatDate(currentPeriodEnd)}
        </p>
      )}
      {error && (
        <div className="mb-3 rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={openPortal}
        disabled={loading}
        className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
      >
        {loading ? "Opening Stripe…" : "Manage subscription"}
      </button>
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
          ? "border-black bg-neutral-50 dark:border-white dark:bg-neutral-900"
          : "border-neutral-200 hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
      }`}
    >
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm font-semibold">{name}</span>
        <span className="text-xs text-neutral-500">{price}</span>
      </div>
      <p className="text-xs text-neutral-600 dark:text-neutral-400">
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
      className="inline-flex rounded-md border border-neutral-200 p-0.5 dark:border-neutral-800"
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
              ? "bg-black text-white dark:bg-white dark:text-black"
              : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
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
