/* eslint-disable react/no-unescaped-entities */
import { Button, Heading, Text } from "@react-email/components";
import { EmailShell, headingStyle, primaryButton } from "./_shell";

export function SubscriptionConfirmationEmail({
  appUrl,
  plan,
  seats,
  quota,
}: {
  appUrl: string;
  plan: "pro" | "team";
  seats: number;
  quota: number;
}) {
  const planLabel = plan === "pro" ? "Pro" : "Team";
  return (
    <EmailShell preview={`Welcome to ContentRX ${planLabel}.`}>
      <Heading as="h1" style={headingStyle}>
        Welcome to ContentRX {planLabel}.
      </Heading>
      <Text>
        Your subscription is active. You're now on {quota.toLocaleString()}{" "}
        checks / month
        {plan === "team" ? ` across ${seats} seat${seats === 1 ? "" : "s"}` : ""}.
      </Text>
      {plan === "team" ? (
        <Text>
          You can now add custom team rules, see team analytics, and invite
          teammates from your dashboard.
        </Text>
      ) : (
        <Text>
          You can manage billing, rotate API keys, and watch usage from the
          dashboard.
        </Text>
      )}
      <Text style={{ marginTop: 20 }}>
        <Button href={`${appUrl}/dashboard`} style={primaryButton}>
          Open dashboard
        </Button>
      </Text>
    </EmailShell>
  );
}
