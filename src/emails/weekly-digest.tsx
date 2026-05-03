/**
 * Weekly review-cadence digest.
 *
 * Fires Monday to the team owner. Summarizes last week's overrides,
 * highlights spikes / new clusters, and points at this week's moment
 * deep-review slot. Dedupe is handled by `sendEmail`'s Redis layer
 * keyed by (user, ISO week).
 *
 * Per ADR 2026-04-25 (private-taxonomy pivot), this email is a
 * customer surface — `standard_id` and `rule_version` must NEVER
 * appear here. We look up the standard's human-readable rule text
 * via STANDARDS_BY_ID and render that instead. Unknown IDs (custom
 * team rules) fall back to a generic phrase.
 */

import { Heading, Link, Section, Text } from "@react-email/components";
import type { WeeklyDigestPayload } from "@/lib/cadence";
import { humanizeMoment } from "@/lib/humanize";
import { STANDARDS_BY_ID } from "@/lib/standards";
import {
  EmailShell,
  bodyStyle as body,
  cautionBox as flagBox,
  primaryButton,
  subStyle as sub,
  subheadingStyle as heading,
} from "./_shell";

// Render a standard's human-readable rule text. Falls back to a
// generic phrase for custom (TEAM-NN) rules so we never leak the raw
// id to the customer-facing email.
function ruleTextFor(standardId: string): string {
  const known = STANDARDS_BY_ID[standardId];
  if (known) return known.rule;
  return "a custom rule your team added";
}

export function WeeklyDigestEmail({ payload }: { payload: WeeklyDigestPayload }) {
  const deltaLabel =
    payload.overrideDeltaPct === null
      ? "new activity (no baseline)"
      : `${payload.overrideDeltaPct >= 0 ? "+" : ""}${payload.overrideDeltaPct}% vs last week`;

  return (
    <EmailShell preview={`ContentRX review digest · ${payload.weekLabel}`}>
      <Heading style={heading}>
        Review digest · {payload.weekLabel}
      </Heading>
      <Text style={body}>
        {payload.totalOverridesThisWeek} findings dismissed this week ({deltaLabel}).{" "}
        {payload.pendingRefinementCount > 0 && (
          <>
            {payload.pendingRefinementCount} taxonomy refinement{" "}
            {payload.pendingRefinementCount === 1 ? "candidate" : "candidates"}
            {" "}waiting for triage.
          </>
        )}
      </Text>

      {payload.urgentFlags.length > 0 && (
        <Section>
          <Text style={sub}>Worth a look</Text>
          {payload.urgentFlags.map((f, i) => (
            <Section key={`${f.standardId ?? "flag"}-${i}`} style={flagBox}>
              <Text style={{ ...body, margin: 0 }}>{f.message}</Text>
            </Section>
          ))}
        </Section>
      )}

      {payload.topStandards.length > 0 && (
        <Section>
          <Text style={sub}>Most-dismissed rules this week</Text>
          {payload.topStandards.map((s, i) => (
            <Text key={`top-${i}`} style={body}>
              {ruleTextFor(s.standardId)}: {s.count}{" "}
              {s.count === 1 ? "dismissal" : "dismissals"}
              {s.moment ? ` · ${humanizeMoment(s.moment)}` : ""}
            </Text>
          ))}
        </Section>
      )}

      <Section>
        <Text style={sub}>This week&apos;s moment deep-review</Text>
        <Text style={body}>{humanizeMoment(payload.nextMoment)}</Text>
      </Section>

      <Section style={{ marginTop: 24 }}>
        <Link href={payload.dashboardUrl} style={primaryButton}>
          View override report
        </Link>
      </Section>
    </EmailShell>
  );
}
