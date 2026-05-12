import { Button, Heading, Text } from "@react-email/components";
import { EmailShell, bodyStyle, headingStyle, primaryButton } from "./_shell";

/**
 * SubscriptionCancelledEmail — sent when Stripe fires
 * `customer.subscription.deleted`.
 *
 * Closes the loop on cancellation. Tone is calm + practical: confirm
 * the cancellation, name what stays, name what's available if they
 * change their mind. No apology, no begging, no feedback ask — the
 * customer just made a decision and we respect it.
 */
export function SubscriptionCancelledEmail({
  appUrl,
  planLabel,
}: {
  appUrl: string;
  /** "Pro", "Team", or whatever the plan label was. */
  planLabel: string;
}) {
  return (
    <EmailShell
      preview={`Your ContentRX ${planLabel} subscription is cancelled.`}
    >
      <Heading as="h1" style={headingStyle}>
        Your ContentRX {planLabel} subscription is cancelled.
      </Heading>
      <Text style={bodyStyle}>
        Stripe stopped the recurring charge. You&apos;re back on the free
        plan, and your account, API key, team rules, and check history
        are all still there.
      </Text>
      <Text style={bodyStyle}>
        Pick {planLabel} back up any time from the dashboard.
      </Text>
      <Text style={{ marginTop: 20 }}>
        <Button href={`${appUrl}/dashboard/settings`} style={primaryButton}>
          Open dashboard
        </Button>
      </Text>
      <Text style={{ ...bodyStyle, marginTop: 24, fontSize: 12 }}>
        Questions or feedback? Reply to this email. We read every message.
      </Text>
    </EmailShell>
  );
}
