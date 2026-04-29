/**
 * /pricing — public pricing page.
 *
 * Two self-serve SKUs at launch: Free and Pro. The Team plan is in
 * flight (per-seat pricing + admin features + shared quota pool, see
 * the 2026-04-28 strategy session); a "Talk to us" CTA serves
 * teams + enterprise until the self-serve Team flow lands.
 *
 * Quotas re-anchored 2026-04-28 alongside the proportional-billing
 * rollout (1 check = up to 3,000 characters):
 *   - Free: 20 checks/month — meaningful flow audit, no scan-the-product
 *   - Pro:  1,000 checks/month at $29 — sustained daily use + bursts
 *   - Team: 1,000/seat shared, $29/seat — coming soon
 */

import type { Metadata } from "next";
import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";

export const metadata: Metadata = {
  title: "Pricing. ContentRX",
  description:
    "Free and Pro. All plans share the same engine, the same calibrated reviewer, and the same surfaces. The only difference is how much you use it.",
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
          $29/month, in your repo, your PR, your Figma file, your terminal,
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
          quota="20 checks per month"
          cta={{ href: "/sign-up", label: "Try free" }}
        />
        <PlanCard
          name="Pro"
          price="$29 / month"
          quota="1,000 checks per month"
          cta={{ href: "/sign-up?plan=pro", label: "Start Pro" }}
          emphasized
        />
        <PlanCard
          name="Team"
          price="Coming soon"
          quota="$29/seat, 1,000/seat shared pool, member management + analytics"
          cta={{ href: "mailto:hello@contentrx.io?subject=Team plan", label: "Talk to us" }}
        />
      </section>

      <section className="mt-16 border-t border-neutral-200 pt-10 dark:border-neutral-800">
        <h2 className="text-lg font-semibold">FAQ</h2>
        <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-6 text-sm sm:grid-cols-2">
          <Faq
            q="What's a check?"
            a={
              <>
                One string up to 3,000 characters evaluated by the
                engine (a verdict, a suggestion, a severity, a
                confidence) in under a second. Longer text counts
                proportionally (1 check per 3,000 characters, max 5
                checks per call). The same cap applies on every surface:
                web app, MCP, CLI, GitHub Action, Figma plugin.
              </>
            }
          />
          <Faq
            q="What happens if I hit my limit on Pro?"
            a={
              <>
                Pro caps at 1,000 checks per month. A hard cap, no
                surprise overage charges. We email at 80% so you have
                warning before you hit the limit. If you&apos;re bumping
                1,000 most months, the Team plan ($29/seat, 1,000/seat
                shared pool) is the right next step.{" "}
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
            q="Do I need a credit card to try it?"
            a="No. Free is 20 checks/mo, no card required. Sign up, install on your surface of choice, and run your first check."
          />
          <Faq
            q="Do I need an Anthropic or OpenAI API key?"
            a="No. ContentRX includes the LLM. You bring your subscription; we handle the AI vendor relationship. No procurement conversation, no security review of another LLM provider, no separate Anthropic billing account to set up. One ContentRX API key covers all five surfaces."
          />
          <Faq
            q="What about teams?"
            a={
              <>
                Team is in early access: $29/seat with a shared quota
                pool (1,000 checks per seat, pooled), member
                management for the team owner, and team-level usage
                analytics. For teams larger than 50 seats, custom
                pricing. Same product, different conversation.{" "}
                <a
                  href="mailto:hello@contentrx.io?subject=Team plan"
                  className="underline underline-offset-2"
                >
                  Email us
                </a>{" "}
                and we&apos;ll get you set up.
              </>
            }
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
  cta,
  emphasized = false,
}: {
  name: string;
  price: string;
  quota: string;
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
