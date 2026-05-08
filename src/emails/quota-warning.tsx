/* eslint-disable react/no-unescaped-entities */
import { Button, Heading, Text } from "@react-email/components";
import { EmailShell, primaryButton, subheadingStyle } from "./_shell";

export function QuotaWarningEmail({
  appUrl,
  used,
  quota,
  plan,
}: {
  appUrl: string;
  used: number;
  quota: number;
  plan: "free" | "pro" | "scale" | "team";
}) {
  const remaining = Math.max(0, quota - used);
  const planLabel =
    plan === "free"
      ? "Free"
      : plan === "pro"
        ? "Pro"
        : plan === "scale"
          ? "Scale"
          : "Team";
  return (
    <EmailShell
      preview={`${remaining} checks left this month on your ${planLabel} plan.`}
    >
      <Heading as="h1" style={subheadingStyle}>
        Heads up. You're approaching your monthly limit.
      </Heading>
      <Text>
        You've used {used} of {quota} checks on your {planLabel} plan this
        month ({remaining} left).
      </Text>
      {plan === "free" ? (
        <Text>
          Upgrade to Pro for 1,000 checks a month. No-meeting checkout,
          cancel anytime.
        </Text>
      ) : (
        <Text>
          Continue uninterrupted past the cap by enabling overage at
          $0.10 per check from your dashboard. Disable anytime.
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
          {plan === "free" ? "Upgrade to Pro" : "Manage overage"}
        </Button>
      </Text>
    </EmailShell>
  );
}
