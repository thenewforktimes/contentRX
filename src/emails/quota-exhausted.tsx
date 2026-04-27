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

export function QuotaExhaustedEmail({
  appUrl,
  quota,
  plan,
  resetsAt,
}: {
  appUrl: string;
  quota: number;
  plan: "free" | "pro" | "team";
  resetsAt: string;
}) {
  const planLabel = plan === "free" ? "Free" : plan === "pro" ? "Pro" : "Team";
  return (
    <EmailShell preview={`Used all ${quota} ${planLabel} checks for the month.`}>
      <Heading as="h1" style={{ fontSize: 20, marginBottom: 12 }}>
        You've hit this month's limit.
      </Heading>
      <Text>
        All {quota} {planLabel}-plan checks are used. Future check attempts
        will return an "over quota" error until {resetsAt}.
      </Text>
      {plan === "free" ? (
        <Text>
          Upgrade to Pro (5,000 checks / month) to keep going right now —
          your remaining quota carries over for the rest of the month.
        </Text>
      ) : (
        <Text>
          Your plan resets on the 1st. If you need more checks before then,
          open the dashboard to manage your subscription.
        </Text>
      )}
      <Text style={{ marginTop: 20 }}>
        <Button
          href={
            plan === "free"
              ? `${appUrl}/dashboard?upgrade=pro`
              : `${appUrl}/dashboard`
          }
          style={button}
        >
          {plan === "free" ? "Upgrade to Pro" : "Open dashboard"}
        </Button>
      </Text>
    </EmailShell>
  );
}
