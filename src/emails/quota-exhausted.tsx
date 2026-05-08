/* eslint-disable react/no-unescaped-entities */
import { Button, Heading, Text } from "@react-email/components";
import { EmailShell, primaryButton, subheadingStyle } from "./_shell";

export function QuotaExhaustedEmail({
  appUrl,
  quota,
  plan,
  resetsAt,
}: {
  appUrl: string;
  quota: number;
  plan: "free" | "pro" | "scale" | "team";
  resetsAt: string;
}) {
  const planLabel =
    plan === "free"
      ? "Free"
      : plan === "pro"
        ? "Pro"
        : plan === "scale"
          ? "Scale"
          : "Team";
  return (
    <EmailShell preview={`Used all ${quota} ${planLabel} checks for the month.`}>
      <Heading as="h1" style={subheadingStyle}>
        You've used your {quota} checks this month.
      </Heading>
      <Text>
        That's the {planLabel}-plan ceiling. Resets {resetsAt}. Until
        then, new checks won't run.
      </Text>
      {plan === "free" ? (
        <Text>
          Upgrade to Pro (1,000 checks / month) to keep going right now.
          Your remaining quota carries over for the rest of the month.
        </Text>
      ) : (
        <Text>
          Enable overage at $0.10 per check to keep checking past the
          cap. We bill it on your next invoice. Disable anytime.
        </Text>
      )}
      <Text style={{ marginTop: 20 }}>
        <Button
          href={
            plan === "free"
              ? `${appUrl}/dashboard?upgrade=pro`
              : `${appUrl}/dashboard/settings/overage`
          }
          style={primaryButton}
        >
          {plan === "free" ? "Upgrade to Pro" : "Enable overage"}
        </Button>
      </Text>
    </EmailShell>
  );
}
