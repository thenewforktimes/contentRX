/**
 * AgentSection — landing page's revamped weekly review agent block.
 *
 * Replaces the prior 3-card grid (which read as "another card grid"
 * against the surrounding sections). The new layout is 2-column at
 * md+: the digest mock on the right shows what the Monday output
 * actually looks like, the value-prop copy on the left names the
 * three load-bearing sub-claims (Read-only, Deterministic, 0 checks
 * per run).
 *
 * The mock is structurally similar to HeroVerdictMock — stylized,
 * decorative, aria-hidden — but uses a single layered "draft PR"
 * card geometry instead of the three-card fan in the hero. One mock
 * per visual moment; the hero owns the per-string finding shape, the
 * agent section owns the weekly-digest shape.
 *
 * Section wraps in a panel (rounded-3xl border + bg-raised/40) so it
 * reads as a section-level beat distinct from the flat-card grids
 * above and below it. Same panel idiom that How-it-works uses, but
 * without the dot-grid backdrop — two dot-grid panels in a row would
 * compete.
 *
 * Pinned copy (the page test asserts on these strings):
 *   - "Weekly review agent" (eyebrow)
 *   - "Drift, caught every Monday." (heading)
 *   - "Read-only.", "Deterministic.", "0 checks per run." (sub-claims)
 *   - "Folded into the Team plan." (pricing read)
 *   - href="/dashboard/agent" (preview link)
 */

import Link from "next/link";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";

export function AgentSection() {
  return (
    <section
      id="agent"
      className="mt-16 rounded-3xl border border-line bg-raised/40 p-8 sm:p-12 scroll-mt-16"
    >
      <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-14">
        <div>
          <Eyebrow>Weekly review agent</Eyebrow>
          <h2 className="mt-2 text-2xl font-semibold text-strong sm:text-3xl">
            Drift, caught every Monday.
          </h2>
          <p className="mt-4 max-w-xl text-base text-default">
            Every Monday a draft pull request lands with last
            week&apos;s recurring patterns. Read-only. Deterministic.
            The catch your senior reviewer would have made.
          </p>

          <ul className="mt-8 grid gap-3 sm:grid-cols-3">
            <ClaimCard
              title="Read-only."
              body="The agent never edits your strings. Every run lands as a draft pull request. Close it, keep it, follow up."
            />
            <ClaimCard
              title="Deterministic."
              body="Patterns from rule-based clustering. Not LLM guessing. Same input, same digest."
            />
            <ClaimCard
              accent
              title="0 checks per run."
              body={
                <>
                  Rendered from your team&apos;s existing flag history.
                  Zero LLM calls. Folded into the Team plan.{" "}
                  <Link
                    href="/dashboard/agent"
                    className="underline underline-offset-2 hover:text-strong"
                  >
                    Try the preview
                  </Link>
                  .
                </>
              }
            />
          </ul>
        </div>

        <div className="relative">
          <DigestMock />
        </div>
      </div>
    </section>
  );
}

function ClaimCard({
  title,
  body,
  accent,
}: {
  title: string;
  body: React.ReactNode;
  accent?: boolean;
}) {
  // The accent variant is reserved for the differentiator card in this
  // grid (0 checks per run). One accent per grid; the Built-for-stack
  // section dropped its accent treatment so this one stands alone on
  // the page.
  const baseClasses = "rounded-lg p-5";
  const surfaceClasses = accent
    ? "border-2 border-accent-affirm-border bg-accent-affirm-soft/30"
    : "border border-line bg-canvas/60";
  return (
    <li className={`${baseClasses} ${surfaceClasses}`}>
      <p className="text-sm font-semibold text-strong">{title}</p>
      <p className="mt-2 text-sm text-default">{body}</p>
    </li>
  );
}

/**
 * DigestMock — stylized "draft PR" card showing what the Monday
 * digest looks like in GitHub. Decorative; aria-hidden so screen
 * readers skip past (the heading + sub-claims carry the meaning).
 *
 * Three pattern bullets shown — same shape as the real PR body
 * (render-digest.ts produces a pattern list followed by the
 * zero-checks footer). Pattern strings here are illustrative, not
 * sourced from a customer's data.
 */
function DigestMock() {
  return (
    <div
      aria-hidden
      className="rounded-xl border border-line bg-canvas p-5 shadow-lg shadow-canvas/40 ring-1 ring-line/40 sm:p-6"
    >
      <div className="flex items-center gap-2">
        <Pill tone="stone" size="xs">
          Draft
        </Pill>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-quiet">
          Pull request
        </span>
        <span className="ml-auto text-[10px] text-quiet">
          Mon · 9:00
        </span>
      </div>

      <p className="mt-3 font-mono text-xs text-quiet">
        thenewforktimes/your-app
      </p>
      <p className="mt-2 text-sm font-semibold text-strong">
        ContentRX weekly review · Apr 28 to May 4
      </p>

      {/* Pattern bullets. The category label sits as a Pill (tag),
          not a heading-with-period or a colon-led label. Pills aren't
          headings, so the engine doesn't flag them as
          headings-with-trailing-periods. Voice rule: no colons. The
          description follows as plain text. */}
      <ol className="mt-4 space-y-3 text-sm">
        <li className="flex gap-2">
          <Pill tone="amber" size="xs">
            Action verbs
          </Pill>
          <p className="text-default">
            12 strings used &lsquo;Submit&rsquo; on a destructive
            action.
          </p>
        </li>
        <li className="flex gap-2">
          <Pill tone="amber" size="xs">
            Plain language
          </Pill>
          <p className="text-default">
            7 strings reached for &lsquo;utilize&rsquo; or
            &lsquo;leverage&rsquo;.
          </p>
        </li>
        <li className="flex gap-2">
          <Pill tone="amber" size="xs">
            Accessibility
          </Pill>
          <p className="text-default">
            4 link strings still read &lsquo;click here&rsquo;.
          </p>
        </li>
      </ol>

      <div className="mt-5 flex items-center gap-3 border-t border-line pt-3 text-[10px] uppercase tracking-wider text-quiet">
        <span className="inline-flex items-center gap-1">
          <span aria-hidden>⚡</span> 0 checks
        </span>
        <span aria-hidden>·</span>
        <span>deterministic</span>
        <span aria-hidden>·</span>
        <span>read-only</span>
      </div>
    </div>
  );
}
