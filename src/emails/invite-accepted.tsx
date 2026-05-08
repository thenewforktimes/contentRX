/* eslint-disable react/no-unescaped-entities */
import { Button, Heading, Text } from "@react-email/components";
import { EmailShell, primaryButton, subheadingStyle } from "./_shell";

export function InviteAcceptedEmail({
  appUrl,
  inviteeEmail,
}: {
  appUrl: string;
  inviteeEmail: string;
}) {
  return (
    <EmailShell preview={`${inviteeEmail} joined your ContentRX team.`}>
      <Heading as="h1" style={subheadingStyle}>
        {inviteeEmail} joined your team.
      </Heading>
      <Text>
        They can now check content against your team's rules and contribute
        to your shared monthly limit.
      </Text>
      <Text style={{ marginTop: 20 }}>
        <Button href={`${appUrl}/dashboard`} style={primaryButton}>
          Open dashboard
        </Button>
      </Text>
    </EmailShell>
  );
}
