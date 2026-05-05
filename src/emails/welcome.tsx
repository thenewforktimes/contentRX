/* eslint-disable react/no-unescaped-entities */
import { Button, Heading, Link, Text } from "@react-email/components";
import { EmailShell, headingStyle, primaryButton } from "./_shell";

export function WelcomeEmail({
  appUrl,
  pluginUrl,
}: {
  appUrl: string;
  pluginUrl: string;
}) {
  return (
    <EmailShell preview="Welcome to ContentRX. Let's get your first check running.">
      <Heading as="h1" style={headingStyle}>
        Welcome to ContentRX.
      </Heading>
      <Text>
        You're on the Free plan: 20 checks a month, every standard,
        no card required. We bill by content length: 1 unit per 200
        characters, rounded up. A button label is 1 unit; a 1,000-
        character paragraph is 5.
      </Text>
      <Text>Three ways to start:</Text>
      <Text>
        1. <Link href={pluginUrl}>Install the Figma plugin</Link> and scan
        a frame in 30 seconds.
        <br />
        2. <Link href={`${appUrl}/dashboard`}>Open your dashboard</Link> to
        grab an API key for the CLI or GitHub Action.
        <br />
        3. Reply to this email. We read every message.
      </Text>
      <Text style={{ marginTop: 20 }}>
        <Button href={`${appUrl}/dashboard`} style={primaryButton}>
          Open dashboard
        </Button>
      </Text>
    </EmailShell>
  );
}
