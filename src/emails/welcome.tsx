/* eslint-disable react/no-unescaped-entities */
import { Button, Heading, Link, Text } from "@react-email/components";
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

export function WelcomeEmail({
  appUrl,
  pluginUrl,
}: {
  appUrl: string;
  pluginUrl: string;
}) {
  return (
    <EmailShell preview="Welcome to ContentRX. Let's get your first check running.">
      <Heading as="h1" style={{ fontSize: 22, marginBottom: 12 }}>
        Welcome to ContentRX.
      </Heading>
      <Text>
        You're on the Free plan: 20 checks a month, every standard, every
        moment, no card required. (1 check = up to 3,000 characters of
        UI copy.)
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
        <Button href={`${appUrl}/dashboard`} style={button}>
          Open dashboard
        </Button>
      </Text>
    </EmailShell>
  );
}
