/* eslint-disable react/no-unescaped-entities */
import { Button, Heading, Text } from "@react-email/components";
import { EmailShell } from "./_shell";

const button: React.CSSProperties = {
  backgroundColor: "#000000",
  color: "#ffffff",
  borderRadius: 6,
  padding: "10px 20px",
  fontWeight: 500,
  fontSize: 14,
  textDecoration: "none",
  display: "inline-block",
};

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
      <Heading as="h1" style={{ fontSize: 22, marginBottom: 12 }}>
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
        <Button href={`${appUrl}/dashboard`} style={button}>
          Open dashboard
        </Button>
      </Text>
    </EmailShell>
  );
}
