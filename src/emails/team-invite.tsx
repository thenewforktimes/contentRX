/* eslint-disable react/no-unescaped-entities */
import { Button, Heading, Text } from "@react-email/components";
import {
  EmailShell,
  captionStyle,
  primaryButton,
  subheadingStyle,
} from "./_shell";

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
      <Heading as="h1" style={subheadingStyle}>
        You're invited to a ContentRX team.
      </Heading>
      <Text>
        {teamOwnerEmail} added you to their ContentRX Team workspace. You
        can use the team's content standards, custom rules, and shared
        check quota.
      </Text>
      <Text style={{ marginTop: 20 }}>
        <Button href={acceptUrl} style={primaryButton}>
          Accept invite
        </Button>
      </Text>
      <Text style={captionStyle}>
        If you didn't expect this, you can ignore the email. Nothing
        happens until you click Accept. Or visit {appUrl} to learn more.
      </Text>
    </EmailShell>
  );
}
