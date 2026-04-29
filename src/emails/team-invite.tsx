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

export function TeamInviteEmail({
  appUrl,
  teamOwnerEmail,
  acceptUrl,
}: {
  appUrl: string;
  teamOwnerEmail: string;
  acceptUrl: string;
}) {
  return (
    <EmailShell
      preview={`${teamOwnerEmail} invited you to a ContentRX team.`}
    >
      <Heading as="h1" style={{ fontSize: 20, marginBottom: 12 }}>
        You're invited to a ContentRX team.
      </Heading>
      <Text>
        {teamOwnerEmail} added you to their ContentRX Team workspace. You
        can use the team's content standards, custom rules, and shared
        check quota.
      </Text>
      <Text style={{ marginTop: 20 }}>
        <Button href={acceptUrl} style={button}>
          Accept invite
        </Button>
      </Text>
      <Text style={{ fontSize: 12, color: "#777" }}>
        If you didn't expect this, you can ignore the email. Nothing
        happens until you click Accept. Or visit {appUrl} to learn more.
      </Text>
    </EmailShell>
  );
}
