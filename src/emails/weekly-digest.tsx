/**
 * Weekly review-cadence digest — human-eval build plan Session 9.
 *
 * Fires weekly to team admins. Summarizes last week's override stream,
 * highlights urgent flags (override-rate spikes + new clusters), and
 * points at this week's moment rotation slot. Dedupe is handled by
 * `sendEmail`'s Redis layer keyed by (user, ISO week).
 */

import { Heading, Link, Section, Text } from "@react-email/components";
import type { WeeklyDigestPayload } from "@/lib/cadence";
import { EmailShell } from "./_shell";

const heading: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  color: "#111",
  margin: "0 0 12px",
};

const sub: React.CSSProperties = {
  fontSize: 13,
  color: "#555",
  margin: "0 0 4px",
};

const body: React.CSSProperties = {
  fontSize: 14,
  color: "#222",
  lineHeight: "1.5",
  margin: "0 0 12px",
};

const mono: React.CSSProperties = {
  fontFamily: "SFMono-Regular, Consolas, monospace",
  fontSize: 12,
};

const flagBox: React.CSSProperties = {
  backgroundColor: "#fff7ed",
  border: "1px solid #fed7aa",
  borderRadius: 6,
  padding: 12,
  marginBottom: 8,
};

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
        {payload.totalOverridesThisWeek} overrides this week ({deltaLabel}).{" "}
        {payload.pendingRefinementCount > 0 && (
          <>
            {payload.pendingRefinementCount} pending refinement-log candidate
            {payload.pendingRefinementCount === 1 ? "" : "s"} waiting for
            triage.
          </>
        )}
      </Text>

      {payload.urgentFlags.length > 0 && (
        <Section>
          <Text style={sub}>Urgent flags</Text>
          {payload.urgentFlags.map((f, i) => (
            <Section key={`${f.standardId}-${i}`} style={flagBox}>
              <Text style={{ ...body, margin: 0 }}>
                <span style={mono}>{f.standardId}</span> — {f.message}
              </Text>
            </Section>
          ))}
        </Section>
      )}

      {payload.topStandards.length > 0 && (
        <Section>
          <Text style={sub}>Top-overridden standards</Text>
          {payload.topStandards.map((s) => (
            <Text key={s.standardId} style={body}>
              <span style={mono}>{s.standardId}</span> · {s.count}x
              {s.moment ? ` · ${s.moment}` : ""}
            </Text>
          ))}
        </Section>
      )}

      <Section>
        <Text style={sub}>This week&apos;s moment deep-review</Text>
        <Text style={body}>
          <span style={mono}>{payload.nextMoment}</span>
        </Text>
      </Section>

      <Section style={{ marginTop: 24 }}>
        <Link
          href={payload.dashboardUrl}
          style={{
            display: "inline-block",
            backgroundColor: "#111",
            color: "#fff",
            padding: "10px 16px",
            borderRadius: 6,
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          Open review dashboard
        </Link>
      </Section>
    </EmailShell>
  );
}
