/**
 * /pricing — public pricing page (PR-04 from
 * pricing-and-unit-of-value-strategy-2026-04-26.md).
 *
 * Shows the locked launch SKUs: Free, Pro, Scale + Audit Pack.
 * Copy comes from Appendix A of the pricing doc.
 *
 * Note: Stripe price IDs in `src/lib/stripe.ts` are still on the
 * pre-locked Pro $24 / Team $35 — PR-05 reconciles by adding the
 * Scale product, removing the Team SKU, and aligning Pro to $29.
 * Until then, all CTAs route to /sign-up; the existing dashboard
 * subscription panel charges what's currently in Stripe (positive
 * surprise for early signups).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";

export const metadata: Metadata = {
  title: "Pricing — ContentRX",
  description:
    "Free, Pro, Scale, and Audit Pack. All plans share the same engine, the same calibrated reviewer, and the same five surfaces. The only difference is how much you use it.",
};

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-20">
      <header className="mb-12 max-w-3xl">
        <Eyebrow>Pricing</Eyebrow>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          A senior content designer&apos;s verdict on every string you ship.
        </h1>
        <p className="mt-4 text-lg text-neutral-700 dark:text-neutral-300">
          $29/month: in your repo, your PR, your Figma file, your terminal —
          without ever leaving the work.
        </p>
        <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
          All plans share the same engine, the same calibrated reviewer,
          and the same five surfaces. The only difference is how much you
          use it.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <PlanCard
          name="Free"
          price="$0"
          quota="250 checks per month"
          overage="Hard cap — no overage"
          cta={{ href: "/sign-up", label: "Try free" }}
        />
        <PlanCard
          name="Pro"
          price="$29 / month"
          quota="5,000 checks per month"
          overage="Overage at $0.005 / check, soft cap default $50"
          cta={{ href: "/sign-up?plan=pro", label: "Start Pro" }}
          emphasized
        />
        <PlanCard
          name="Scale"
          price="$99 / month"
          quota="25,000 checks per month"
          overage="Overage at $0.003 / check, soft cap default $200"
          cta={{ href: "/sign-up?plan=scale", label: "Start Scale" }}
        />
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-semibold">
          Have a one-time project? Skip the subscription.
        </h2>
        <Card variant="emphasis" className="mt-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-base font-semibold">Audit Pack — $99</h3>
              <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
                25,000 checks. Valid 90 days. No subscription.
              </p>
              <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
                For codebase audits, design system reviews, or pre-launch
                content sweeps.
              </p>
            </div>
            <Link
              href="/sign-up?plan=audit"
              className={buttonStyles({ variant: "primary" })}
            >
              Buy a pack
            </Link>
          </div>
        </Card>
      </section>

      <section className="mt-16 border-t border-neutral-200 pt-10 dark:border-neutral-800">
        <h2 className="text-lg font-semibold">FAQ — quick</h2>
        <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-6 text-sm sm:grid-cols-2">
          <Faq
            q="What's a check?"
            a="One string evaluated by the engine — a verdict, a suggestion, a severity, a confidence — in under a second. Scanning a Figma frame with 23 strings consumes 23 checks."
          />
          <Faq
            q="What happens if I hit my quota on Pro?"
            a={
              <>
                Nothing breaks. You keep working at $0.005 per additional
                check, up to a soft cap you set (default $50). We email at
                80% of the cap; you can raise it any time. If you&apos;re
                hitting 5,000 every month, Scale at $99 is probably cheaper.
              </>
            }
          />
          <Faq
            q="Can I cancel anytime?"
            a="Yes — Stripe-hosted Customer Portal, no email-us-to-cancel pattern, no retention dark patterns. Your team setup stays put for 90 days after cancellation; come back within that window and you pick up where you left off."
          />
          <Faq
            q="Do I need a credit card to try it?"
            a="No. Free is 250 checks/mo, no card required. Sign up, install on your surface of choice, and run your first check."
          />
          <Faq
            q="What about teams?"
            a={
              <>
                When 3+ teammates from the same email domain are on Pro or
                Scale, we automatically roll your invoices into one and
                surface team-level views in the dashboard. No team-purchase
                decision required.
              </>
            }
          />
          <Faq
            q="Where do I install it?"
            a={
              <>
                MCP (Claude Code, Cursor), LSP (VS Code, Zed, any LSP
                editor), CLI, GitHub Action, and the Figma plugin —
                {" "}
                <Link href="/install" className="underline underline-offset-2">
                  install instructions for each
                </Link>
                .
              </>
            }
          />
        </dl>
      </section>

      <footer className="mt-16 border-t border-neutral-200 pt-8 text-sm text-neutral-500 dark:border-neutral-800">
        <p>
          Questions?{" "}
          <a
            href="mailto:hello@contentrx.io"
            className="underline underline-offset-2"
          >
            hello@contentrx.io
          </a>
          . The accountability surface:{" "}
          <Link href="/accuracy" className="underline underline-offset-2">
            /accuracy
          </Link>{" "}
          ·{" "}
          <Link href="/sources" className="underline underline-offset-2">
            /sources
          </Link>{" "}
          ·{" "}
          <Link href="/ethics" className="underline underline-offset-2">
            /ethics
          </Link>
          .
        </p>
      </footer>
    </main>
  );
}

function PlanCard({
  name,
  price,
  quota,
  overage,
  cta,
  emphasized = false,
}: {
  name: string;
  price: string;
  quota: string;
  overage: string;
  cta: { href: string; label: string };
  emphasized?: boolean;
}) {
  return (
    <Card
      variant={emphasized ? "emphasis" : "default"}
      padding="lg"
      className="flex flex-col gap-4"
    >
      <div>
        <h2 className="text-lg font-semibold">{name}</h2>
        <p className="mt-1 text-2xl font-semibold">{price}</p>
      </div>
      <div className="flex-1 space-y-2 text-sm text-neutral-700 dark:text-neutral-300">
        <p className="font-medium">{quota}</p>
        <p className="text-neutral-600 dark:text-neutral-400">{overage}</p>
        <p className="text-neutral-600 dark:text-neutral-400">
          All five surfaces.
        </p>
      </div>
      <Link
        href={cta.href}
        className={buttonStyles({
          variant: emphasized ? "primary" : "secondary",
        })}
      >
        {cta.label}
      </Link>
    </Card>
  );
}

function Faq({ q, a }: { q: string; a: React.ReactNode }) {
  return (
    <div>
      <dt className="font-medium text-neutral-900 dark:text-neutral-100">
        {q}
      </dt>
      <dd className="mt-1 text-neutral-700 dark:text-neutral-300">{a}</dd>
    </div>
  );
}
