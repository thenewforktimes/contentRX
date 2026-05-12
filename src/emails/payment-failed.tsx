import { Button, Heading, Text } from "@react-email/components";
import { EmailShell, bodyStyle, headingStyle, primaryButton } from "./_shell";

/**
 * PaymentFailedEmail — sent when Stripe fires `invoice.payment_failed`.
 *
 * Stripe keeps the subscription active through the grace period
 * configured in Dashboard → Billing → Retry settings (default ~3
 * weeks of smart retries before cancellation). This email tells the
 * customer their card failed and links them at the Stripe Portal to
 * update payment details before access is lost.
 *
 * Tone: short, practical, no shame. The most common cause is a
 * card that needs renewing — not anything the customer did wrong.
 */
export function PaymentFailedEmail({
  appUrl,
  planLabel,
}: {
  appUrl: string;
  /** "Pro", "Team", "Scale", or whatever the plan label is. */
  planLabel: string;
}) {
  return (
    <EmailShell
      preview={`Update your card to keep ContentRX ${planLabel}.`}
    >
      <Heading as="h1" style={headingStyle}>
        Update your card to keep ContentRX {planLabel}.
      </Heading>
      <Text style={bodyStyle}>
        Stripe couldn&apos;t charge your card. Update your payment
        method in the dashboard to keep access to your subscription.
      </Text>
      <Text style={bodyStyle}>
        Stripe will retry the charge a few times automatically. Open
        the dashboard to update your card before the retries run out.
      </Text>
      <Text style={{ marginTop: 20 }}>
        <Button href={`${appUrl}/dashboard/settings`} style={primaryButton}>
          Update payment method
        </Button>
      </Text>
      <Text style={{ ...bodyStyle, marginTop: 24, fontSize: 12 }}>
        Questions? Reply to this email. We read every message.
      </Text>
    </EmailShell>
  );
}
