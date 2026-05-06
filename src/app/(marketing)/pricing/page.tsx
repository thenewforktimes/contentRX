/**
 * /pricing — public pricing page.
 *
 * Five-tier structure (locked pre-pilot, 2026-04-30 strategy):
 *   - Free:       20 checks/mo, 1 repo. Acquisition flywheel.
 *   - Pro:        $39/mo ($32 annual). 2,000 checks/mo. Solo PMs / designers.
 *   - Team:       $59/seat (5-seat min, annual). 5,000 checks/seat pooled.
 *                 Sales-assisted at launch; self-serve post-pilot.
 *   - Scale:      $1,499/mo flat. 10-seat cap, 50,000 checks/mo,
 *                 multi-brand voices, agency multi-client. Sales-assisted.
 *   - Enterprise: Coming soon. SSO/SAML, SCIM, audit logs, custom rules,
 *                 dedicated CSM, SOC 2 Type II. $36k/yr floor when ready.
 *
 * Metering shape (schema 3.0.0): 1 unit per 200 characters, rounded up.
 * A button label bills as 1 unit; a 4,000-char doc bills as 20.
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
    "Free for solo evaluation. $39/month for individual professionals. $59/seat for small teams. $1,499/mo flat for agencies and design-system orgs. Enterprise coming soon.",
};

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-20">
      <PageHeader
        className="max-w-3xl"
        eyebrow="Pricing"
        title="A staff content designer's verdict on every string you ship."
        lede={
          <>
            Free to start, $39/month to use it daily, $59/seat for teams.
            In your repo, your PR, your Figma file, your terminal, without
            ever leaving the work.
          </>
        }
        meta={
          <>
            All paid plans share the same engine, the same calibrated
            reviewer, and the same five surfaces. The differences are
            seat count, monthly checks, and admin features.
          </>
        }
      />

      <section
        className="grid grid-cols-1 gap-4 sm:grid-cols-3"
        aria-label="Self-serve and small-team plans"
      >
        <PlanCard
          name="Free"
          price="$0"
          quota="20 checks per month"
          features={[
            "1 repo",
            "Short copy and long-form review",
            "All five surfaces",
          ]}
          cta={{ href: "/sign-up", label: "Start free" }}
        />
        <PlanCard
          name="Pro"
          price="$39 / month"
          priceSubnote="$32/month billed annually"
          quota="2,000 checks per month"
          features={[
            "Short copy and long-form review",
            "Custom rule overrides",
            "Slack + Figma plugin + GitHub Action",
          ]}
          cta={{ href: "/sign-up?plan=pro", label: "Start free trial" }}
          emphasized
          mostPopular
        />
        <PlanCard
          name="Team"
          price="$59 / seat / month"
          priceSubnote="annual billing, 5-seat minimum"
          quota="5,000 checks per seat, pooled"
          features={[
            "Everything in Pro",
            "Rule sharing across the team",
            "Member management + analytics",
            "GitHub PR bot at the org level",
          ]}
          cta={{
            href: "mailto:hello@contentrx.io?subject=Team plan",
            label: "Contact sales",
          }}
        />
      </section>

      <section
        className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2"
        aria-label="Larger-team and enterprise plans"
      >
        <PlanCard
          name="Scale"
          price="$1,499 / month"
          priceSubnote="flat, billed annually"
          quota="50,000 checks per month, pooled"
          features={[
            "Everything in Team",
            "10-seat cap, multi-brand voices",
            "Agency multi-client billing",
            "$0.05 per check overage",
          ]}
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
            "SSO/SAML + SCIM + audit logs",
            "Custom rules + dedicated CSM",
            "Self-hosted option + IP indemnification",
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
                One pass of the engine over your content. We bill by
                content length: <strong>1 unit per 200 characters</strong>,
                rounded up. A button label or error message bills as 1
                unit. A 1,000-character paragraph bills as 5. A
                4,000-character doc bills as 20. The estimator in your
                dashboard shows the unit cost before you submit, so the
                price is never a surprise.
              </>
            }
          />
          <Faq
            q="Why bill by length?"
            a="Because reviewing one button label and reviewing a full screen of copy aren't the same work. Length is honest and predictable. Short copy is cheap; long content costs proportionally more. No tier toggles to learn, no decision to mis-make at submit time."
          />
          <Faq
            q="What happens if I hit my limit on Pro?"
            a={
              <>
                Pro caps at 2,000 checks per month, equivalent to
                400,000 characters of content reviewed. A hard cap, no
                surprise overage charges. We email at 80% so you have warning
                before you hit the limit. If you&apos;re bumping 2,000
                most months, the Team plan ($59/seat with 5,000 pooled
                per seat) is the right next step.{" "}
                <a
                  href="mailto:hello@contentrx.io?subject=Team plan"
                  className="underline underline-offset-2"
                >
                  Email us
                </a>{" "}
                and we&apos;ll set it up.
              </>
            }
          />
          <Faq
            q="Can I cancel anytime?"
            a="Yes. Stripe-hosted Customer Portal, no email-us-to-cancel pattern, no retention dark patterns. Your team setup stays put for 90 days after cancellation; come back within that window and you pick up where you left off."
          />
          <Faq
            q="How do I know the accuracy holds up over time?"
            a={
              <>
                Every Monday, the calibration log at{" "}
                <Link href="/calibration" className="underline underline-offset-2">
                  /calibration
                </Link>
                {" "}publishes the previous week&apos;s measured accuracy,
                drift signals, and which standards were refined. The
                discernment loop is public: you can read what changed
                and why. If kappa drops, you&apos;ll see it before you
                feel it.
              </>
            }
          />
          <Faq
            q="Do I need a credit card to try it?"
            a="No. Free is 20 checks/mo, no card required. Sign up, install on your surface of choice, and run your first check."
          />
          <Faq
            q="Do I need an Anthropic or OpenAI API key?"
            a="No. ContentRX includes the LLM. You bring your subscription; we handle the AI vendor relationship. No procurement conversation, no security review of another LLM provider, no separate Anthropic billing account to set up. One ContentRX API key covers all five surfaces."
          />
          <Faq
            q="When does Enterprise become available?"
            a="When SOC 2 Type II is in hand and SSO/SAML/SCIM are wired. Enterprise pricing starts at $36,000/year and includes audit logs, custom rules, dedicated CSM, a self-hosted option, and IP indemnification. If you have an Enterprise procurement timeline, email us and we'll let you know when we're ready."
          />
          <Faq
            q="Where do I install it?"
            a={
              <>
                MCP (Claude Code, Cursor), LSP (VS Code, Zed, any LSP
                editor), CLI, GitHub Action, and the Figma plugin.{" "}
                <Link href="/install" className="underline underline-offset-2">
                  Install instructions for each
                </Link>
                .
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
  cta?: { href: string; label: string };
  emphasized?: boolean;
  mostPopular?: boolean;
  unavailable?: boolean;
}) {
  return (
    <Card
      variant={emphasized ? "emphasis" : "default"}
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
