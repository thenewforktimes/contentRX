/**
 * /pricing — public pricing page.
 *
 * Five-tier structure (locked 2026-05-07 by _private/pricing-analysis.md):
 *   - Free:       10 checks/mo. Acquisition flywheel.
 *   - Pro:        $39/mo ($379/yr, 20% off). 1,000 checks/mo. Self-serve.
 *   - Team:       $79/seat/mo ($759/seat/yr, 20% off). 2,000 checks/seat,
 *                 pooled. Self-serve, no seat minimum. Most popular tier
 *                 (the version of ContentRX that uses ContentRX).
 *   - Scale:      $1,799/mo ($17,299/yr, 20% off). 60,000 checks pooled,
 *                 10-seat cap. Self-serve in Stripe.
 *   - Enterprise: Coming soon. SSO/SAML, SCIM, audit logs, custom rules,
 *                 dedicated CSM, SOC 2 Type II. $36k/yr floor when ready.
 *
 * Above the cap: hard cap by default. Pro, Team, and Scale customers
 * can opt in to $0.10/check overage from their dashboard.
 *
 * Metering shape (schema 3.0.0): 1 check per 200 characters, rounded up.
 * A button label bills as 1 check; a 4,000-char doc bills as 20.
 *
 * 2026-05-11 polish pass:
 *   - "Most popular" badge moves Pro → Team. Team is the version of
 *     the product that uses the product (custom rules + weekly review
 *     agent). The badge's job is to signal honest recommendation,
 *     not minimize procurement friction (procurement-friendliness
 *     comes from the $79/seat-no-minimum + self-serve trial pattern).
 *   - Bullet count normalized to 3 per card. Free + Pro padded with
 *     a third short bullet so cards stop stretching to Team's height.
 *     Team's bullets cut from 4 → 3 (member-management dropped, it
 *     was table-stakes).
 *   - CTAs verb-led + tier-named: "Try Pro free", "Try Team free",
 *     "Try Scale free". Scale was "Contact sales" — replaced with the
 *     trial CTA since Scale is self-serve in Stripe.
 *   - FAQ converted to native <details>/<summary> accordion. The
 *     prior 2-column grid had density mismatches (long FAQ next to
 *     short FAQ created uneven columns); accordion lets readers
 *     scan all 9 questions at a glance and expand only the ones
 *     they care about.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { ButtonArrow, buttonStyles } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";

export const metadata: Metadata = {
  title: "Pricing. ContentRX",
  description:
    "Free for evaluation. $39/month to use it daily. $79/seat for teams. $1,799/month for design-system orgs. Enterprise coming soon.",
};

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-20">
      <PageHeader
        className="max-w-3xl"
        eyebrow="Pricing"
        eyebrowHighlight
        scale="display"
        title="Staff-level content design review on every check you ship."
        lede={
          <>
            Free for evaluation. $39/month to use it daily. $79/seat
            for teams. In your repo, your PR, your Figma file, your
            terminal, without leaving the work.
          </>
        }
        meta={<>Same engine, same standards, every plan.</>}
      />

      <section
        className="grid grid-cols-1 gap-4 sm:grid-cols-3"
        aria-label="Self-serve and small-team plans"
      >
        <PlanCard
          name="Free"
          price="$0"
          quota="10 checks per month"
          features={[
            "Short and long-form review",
            "Every standard, every surface",
            "No credit card",
          ]}
          cta={{ href: "/sign-up", label: "Start free" }}
        />
        <PlanCard
          name="Pro"
          price="$39 / month"
          priceSubnote="$379/year (save 20%)"
          quota="1,000 checks per month"
          features={[
            "Built for daily use",
            "All surfaces, all standards",
            "Cancel anytime",
          ]}
          overageNote="Hard cap by default. Opt in to $0.10/check overage from your dashboard."
          cta={{ href: "/sign-up", label: "Try Pro free" }}
        />
        <PlanCard
          name="Team"
          price="$79 / seat / month"
          priceSubnote="$759/seat/year (save 20%)"
          quota="2,000 checks per seat, pooled"
          features={[
            "Everything in Pro",
            "Weekly review agent",
            "Team rule overrides",
          ]}
          overageNote="Hard cap by default. Opt in to $0.10/check overage from your dashboard."
          cta={{ href: "/sign-up", label: "Try Team free" }}
          emphasized
          mostPopular
        />
      </section>

      <section
        className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2"
        aria-label="Larger-team and enterprise plans"
      >
        <PlanCard
          name="Scale"
          price="$1,799 / month"
          priceSubnote="$17,299/year (save 20%)"
          quota="60,000 checks per month, pooled"
          features={[
            "Everything in Team",
            "Triple the checks of 10 Team seats",
            "10-seat cap, one flat invoice",
          ]}
          overageNote="Hard cap by default. Opt in to $0.10/check overage from your dashboard."
          cta={{ href: "/sign-up", label: "Try Scale free" }}
        />
        <PlanCard
          name="Enterprise"
          price="Coming soon"
          priceSubnote="SSO + SOC 2 Type II in progress"
          quota="Custom checks, custom seats"
          features={[
            "Everything in Scale",
            "SSO/SAML, SCIM, audit logs",
            "Self-hosted, IP indemnification",
          ]}
          unavailable
        />
      </section>

      <section className="mt-16">
        <h2 className="text-lg font-semibold">FAQ</h2>
        {/* Accordion order locked 2026-05-11 (Robo's IA call):
              1. What's a check?              (mechanic)
              2. What kind of writing...      (fit)
              3. What's the weekly review...  (feature)
              4. Does ContentRX have monthly limits?  (boundaries)
              5. Can I cancel anytime?        (commitment)
              6. Do I need a credit card...   (friction)
              7. Do I need an Anthropic...    (friction)
              8. Where do I install it?       (next step)
              9. Is ContentRX accurate?       (proof, the closer)
            Mechanic → fit → feature → boundaries → commitment →
            friction × 2 → install → proof. Reads as a buyer's
            mental walkthrough, ending on the moat link. */}
        <ul className="mt-4 divide-y divide-line border-y border-line">
          <FaqRow
            q="What's a check?"
            a={
              <>
                1 check = 200 characters, rounded up. A button label
                is 1 check. A 1,000-character paragraph is 5.
              </>
            }
          />
          <FaqRow
            q="What kind of writing does ContentRX handle?"
            a={
              <>
                Short-form UI copy (button labels, error messages,
                tooltips) and long-form internal writing (product
                update emails, security advisories, all-hands
                pre-reads, policy notices). The engine is calibrated
                for product and internal writing. For persuasive
                marketing copy, expect more &lsquo;worth a
                look&rsquo; flags than usual.{" "}
                <Link href="/writes" className="underline underline-offset-2">
                  See six worked examples
                </Link>
                .
              </>
            }
          />
          <FaqRow
            q="What's the weekly review agent?"
            a={
              <>
                A read-only agent on the Team plan and up that opens
                a draft pull request every Monday with the
                recurring-pattern flags from your team&apos;s last
                week. Deterministic. Read-only. 0 checks per run.{" "}
                <Link
                  href="/dashboard/agent"
                  className="underline underline-offset-2"
                >
                  Try the preview
                </Link>
                .
              </>
            }
          />
          <FaqRow
            q="Does ContentRX have monthly limits?"
            a={
              <>
                Yes. Each plan has a monthly check limit.
                <ul className="mt-2 space-y-1">
                  <li>
                    <span className="font-medium text-strong">Free</span>,
                    10 checks.
                  </li>
                  <li>
                    <span className="font-medium text-strong">Pro</span>,
                    1,000 checks.
                  </li>
                  <li>
                    <span className="font-medium text-strong">Team</span>,
                    2,000 checks per seat, pooled.
                  </li>
                  <li>
                    <span className="font-medium text-strong">Scale</span>,
                    60,000 checks pooled, 10-seat cap.
                  </li>
                </ul>
                <p className="mt-3">
                  Email warnings at 80% and 100%. Checks pause at the
                  cap by default. Opt into $0.10/check overage from
                  your dashboard to keep going.
                </p>
              </>
            }
          />
          <FaqRow
            q="Can I cancel anytime?"
            a="Yes. Stripe-hosted Customer Portal. Your team setup stays put for 90 days after cancellation."
          />
          <FaqRow
            q="Do I need a credit card to try ContentRX?"
            a="No. Free is 10 checks per month, no card required."
          />
          <FaqRow
            q="Do I need an Anthropic or OpenAI key?"
            a="No. ContentRX includes the LLM. One API key covers all five surfaces."
          />
          <FaqRow
            q="Where do I install it?"
            a={
              <>
                <Link href="/install" className="underline underline-offset-2">
                  /install
                </Link>
                {" "}covers the MCP server, the LSP, the CLI, the
                GitHub Action, and the Figma plugin.
              </>
            }
          />
          <FaqRow
            q="Is ContentRX accurate?"
            a={
              <>
                Every Monday, the calibration log on{" "}
                <Link href="/accuracy" className="underline underline-offset-2">
                  /accuracy
                </Link>
                {" "}publishes the previous week&apos;s measured kappa,
                drift signals, and which standards were refined. If
                the number drops, you&apos;ll see it before you feel
                it. The same page covers the methodology.
              </>
            }
          />
        </ul>
      </section>
    </main>
  );
}

function PlanCard({
  name,
  price,
  priceSubnote,
  quota,
  features,
  overageNote,
  cta,
  emphasized = false,
  mostPopular = false,
  unavailable = false,
}: {
  name: string;
  price: string;
  priceSubnote?: string;
  quota: string;
  features: string[];
  overageNote?: string;
  cta?: { href: string; label: string };
  emphasized?: boolean;
  mostPopular?: boolean;
  unavailable?: boolean;
}) {
  return (
    <Card
      variant={emphasized ? "accent" : "default"}
      padding="lg"
      className="flex flex-col gap-4"
    >
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{name}</h2>
          {mostPopular && <Pill tone="emerald">Most popular</Pill>}
          {unavailable && <Pill tone="neutral">In progress</Pill>}
        </div>
        <p className="mt-1 text-2xl font-semibold">{price}</p>
        {priceSubnote && (
          <p className="mt-1 text-xs text-quiet">
            {priceSubnote}
          </p>
        )}
      </div>
      <div className="flex-1 space-y-2 text-sm text-default">
        <p className="font-medium">{quota}</p>
        <ul className="space-y-1 text-quiet">
          {features.map((feature) => (
            <li key={feature} className="flex gap-2">
              <span aria-hidden>·</span>
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </div>
      {overageNote && (
        <p className="text-xs text-quiet">{overageNote}</p>
      )}
      {cta ? (
        <Link
          href={cta.href}
          className={buttonStyles({
            variant: emphasized ? "primary" : "secondary",
          })}
        >
          {cta.label} <ButtonArrow />
        </Link>
      ) : (
        <p className="text-xs text-quiet">
          We&apos;ll announce availability on{" "}
          <Link href="/accuracy" className="underline underline-offset-2">
            /accuracy
          </Link>{" "}
          and via email when SOC 2 Type II clears.
        </p>
      )}
    </Card>
  );
}

/**
 * FaqRow — single accordion row using native <details>/<summary>.
 *
 * Closed by default. Click/tap/Enter on the summary toggles. The
 * `marker:hidden` and explicit chevron span keep the chevron a
 * proper styled element instead of the browser's default disclosure
 * triangle.
 */
function FaqRow({ q, a }: { q: string; a: React.ReactNode }) {
  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-base font-medium text-strong marker:hidden hover:text-default [&::-webkit-details-marker]:hidden">
          <span>{q}</span>
          <span
            aria-hidden
            className="text-quiet transition-transform group-open:rotate-180"
          >
            ▼
          </span>
        </summary>
        <div className="pb-5 pr-8 text-sm text-default">
          {a}
        </div>
      </details>
    </li>
  );
}
