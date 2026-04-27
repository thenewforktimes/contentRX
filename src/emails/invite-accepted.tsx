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

export function InviteAcceptedEmail({
  appUrl,
  inviteeEmail,
}: {
  appUrl: string;
  inviteeEmail: string;
}) {
  return (
    <EmailShell preview={`${inviteeEmail} joined your ContentRX team.`}>
      <Heading as="h1" style={{ fontSize: 20, marginBottom: 12 }}>
        {inviteeEmail} joined your team.
      </Heading>
      <Text>
        They can now check content against your team's rules and contribute
        to your shared monthly quota.
      </Text>
      <Text style={{ marginTop: 20 }}>
        <Button href={`${appUrl}/dashboard`} style={button}>
          Open dashboard
        </Button>
      </Text>
    </EmailShell>
  );
}
