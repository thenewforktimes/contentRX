/**
 * /pricing — public pricing page.
 *
 * Five-tier structure (locked 2026-05-07 by _private/pricing-analysis.md;
 * copy rewritten 2026-05-09 per the audit that cut speculative features
 * — multi-brand voices, agency multi-client billing, GitHub PR bot,
 * Slack integration, "custom rule overrides" on Pro, team analytics —
 * none of which had shipping code):
 *   - Free:       10 checks/mo. Acquisition flywheel.
 *   - Pro:        $39/mo ($379/yr, 20% off). 1,000 checks/mo. Self-serve.
 *   - Team:       $79/seat/mo ($759/seat/yr, 20% off). 2,000 checks/seat,
 *                 pooled across the team. Self-serve, no seat minimum.
 *                 Weekly review agent ships at this tier.
 *   - Scale:      $1,799/mo ($17,299/yr, 20% off). 60,000 checks pooled,
 *                 10-seat cap. Sales-assisted.
 *   - Enterprise: Coming soon. SSO/SAML, SCIM, audit logs, custom rules,
 *                 dedicated CSM, SOC 2 Type II. $36k/yr floor when ready.
 *
 * Above the cap: hard cap by default. Pro, Team, and Scale customers
 * can opt in to $0.10/check overage from their dashboard (Phase 4).
 *
 * Metering shape (schema 3.0.0): 1 check per 200 characters, rounded up.
 * A button label bills as 1 check; a 4,000-char doc bills as 20.
 *
 * Weekly review agent (added to Team + Scale features 2026-05-10): the
 * Monday-cadence drift digest agent is a Team-plan-and-up feature.
 * Calling it out by name on the plan cards (instead of letting it hide
 * inside "Everything in Pro/Team") because it's a load-bearing
 * differentiator — deterministic, read-only, 0 checks per run — that a
 * buyer's eye should land on while comparing tiers.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";
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
        scale="display"
        title="Staff-level content design review on every string you ship."
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
            "For engineers, product managers, and independent designers",
          ]}
          overageNote="Hard cap by default. Opt in to $0.10/check overage from your dashboard."
          cta={{ href: "/sign-up", label: "Start free trial" }}
          emphasized
          mostPopular
        />
        <PlanCard
          name="Team"
          price="$79 / seat / month"
          priceSubnote="$759/seat/year (save 20%)"
          quota="2,000 checks per seat, pooled"
          features={[
            "Everything in Pro",
            "Weekly review agent (Monday drift digest, 0 checks per run)",
            "Custom rules your team owns. Override ours. Add your own.",
            "Member management with pooled checks",
          ]}
          overageNote="Hard cap by default. Opt in to $0.10/check overage from your dashboard."
          cta={{ href: "/sign-up", label: "Start free trial" }}
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
            "Everything in Team, including the weekly review agent",
            "Triple the checks of 10 Team seats",
            "10-seat cap, one flat invoice",
          ]}
          overageNote="Hard cap by default. Opt in to $0.10/check overage from your dashboard."
          cta={{
            href: "mailto:hello@contentrx.io?subject=Scale plan",
            label: "Contact sales",
          }}
        />
        <PlanCard
          name="Enterprise"
          price="Coming soon"
          priceSubnote="SSO + SOC 2 Type II in progress"
          quota="Custom checks, custom seats"
          features={[
            "Everything in Scale",
            "SSO/SAML, SCIM, audit logs",
            "Custom rules, dedicated CSM",
            "Self-hosted option, IP indemnification",
          ]}
          unavailable
        />
      </section>

      <section className="mt-16 border-t border-line pt-10">
        <h2 className="text-lg font-semibold">FAQ</h2>
        <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-6 text-sm sm:grid-cols-2">
          <Faq
            q="What's a check?"
            a={
              <>
                1 check = 200 characters, rounded up. A button label
                is 1 check. A 1,000-character paragraph is 5.
              </>
            }
          />
          <Faq
            q="What kind of writing does this handle?"
            a={
              <>
                Short-form UI strings (button labels, error messages,
                tooltips) and long-form internal writing (product
                update emails, security advisories, all-hands
                pre-reads, policy notices). The engine is calibrated
                for product and internal writing; for persuasive
                marketing copy expect more &lsquo;worth a look&rsquo;
                flags than usual.{" "}
                <Link href="/writes" className="underline underline-offset-2">
                  See six worked examples
                </Link>
                .
              </>
            }
          />
          <Faq
            q="What's the weekly review agent?"
            a={
              <>
                A read-only agent on the Team plan and up that opens
                a draft pull request every Monday with the
                recurring-pattern flags from your team&apos;s last
                week. Deterministic. Read-only. 0 checks per run
                (the digest is rendered from your team&apos;s
                existing flag history, not a fresh LLM pass).{" "}
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
          <Faq
            q="What if I hit my limit on Pro?"
            a={
              <>
                You&apos;ll get an email at 80% and again at 100%. By
                default, checks pause at the cap. Opt into $0.10/check
                overage from your dashboard if you want to keep going.
              </>
            }
          />
          <Faq
            q="Can I cancel anytime?"
            a="Yes. Stripe-hosted Customer Portal. Your team setup stays put for 90 days after cancellation."
          />
          <Faq
            q="How do I know the accuracy holds up?"
            a={
              <>
                Every Monday, the{" "}
                <Link href="/calibration" className="underline underline-offset-2">
                  calibration log
                </Link>
                {" "}publishes the previous week&apos;s measured kappa,
                drift signals, and which standards were refined. If the
                number drops, you&apos;ll see it before you feel it.
              </>
            }
          />
          <Faq
            q="Do I need a credit card to try it?"
            a="No. Free is 10 checks per month, no card required."
          />
          <Faq
            q="Do I need an Anthropic or OpenAI key?"
            a="No. ContentRX includes the LLM. One API key covers all five surfaces."
          />
          <Faq
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
        </dl>
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
          {cta.label}
        </Link>
      ) : (
        <p className="text-xs text-quiet">
          We&apos;ll announce availability on{" "}
          <Link href="/calibration" className="underline underline-offset-2">
            /calibration
          </Link>{" "}
          and via email when SOC 2 Type II clears.
        </p>
      )}
    </Card>
  );
}

function Faq({ q, a }: { q: string; a: React.ReactNode }) {
  return (
    <div>
      <dt className="font-medium text-strong">
        {q}
      </dt>
      <dd className="mt-1 text-default">{a}</dd>
    </div>
  );
}
