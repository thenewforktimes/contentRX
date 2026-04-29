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

export function QuotaWarningEmail({
  appUrl,
  used,
  quota,
  plan,
}: {
  appUrl: string;
  used: number;
  quota: number;
  plan: "free" | "pro" | "team";
}) {
  const remaining = Math.max(0, quota - used);
  const planLabel = plan === "free" ? "Free" : plan === "pro" ? "Pro" : "Team";
  return (
    <EmailShell
      preview={`${remaining} checks left this month on your ${planLabel} plan.`}
    >
      <Heading as="h1" style={{ fontSize: 20, marginBottom: 12 }}>
        Heads up. You're approaching your monthly limit.
      </Heading>
      <Text>
        You've used {used} of {quota} checks on your {planLabel} plan this
        month ({remaining} left).
      </Text>
      {plan === "free" && (
        <Text>
          Upgrade to Pro for 1,000 checks a month. No-meeting checkout,
          cancel anytime.
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
