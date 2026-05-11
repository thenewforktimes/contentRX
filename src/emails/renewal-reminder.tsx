import { Button, Heading, Text } from "@react-email/components";
import { EmailShell, bodyStyle, headingStyle, primaryButton } from "./_shell";

/**
 * RenewalReminderEmail — sent 15 days before each subscription's
 * current_period_end via /api/cron/renewal-reminder.
 *
 * Required by the California Automatic Renewal Law (CARL / AB 2863):
 * customers on subscriptions of 1+ year must receive at least one
 * annual reminder before renewal. We send 15 days out for every
 * cycle (monthly + annual) — overshoots CARL for monthly cycles but
 * keeps cadence simple and avoids surprise charges. Attorney may
 * relax the monthly cadence in Phase B.
 *
 * Plain language: name the plan, the renewal date, the amount, and
 * the cancel path (Stripe Portal via /dashboard/settings).
 */
export function RenewalReminderEmail({
  appUrl,
  planLabel,
  renewalDate,
  amountLabel,
}: {
  appUrl: string;
  /** "Pro", "Team (5 seats)", "Scale". Caller pre-formats. */
  planLabel: string;
  /** Pre-formatted renewal date string, e.g. "May 26, 2026". */
  renewalDate: string;
  /** Pre-formatted price string, e.g. "$39.00" or "$395.00". */
  amountLabel: string;
}) {
  return (
    <EmailShell
      preview={`Your ContentRX ${planLabel} subscription renews on ${renewalDate}.`}
    >
      <Heading as="h1" style={headingStyle}>
        Your ContentRX subscription renews soon.
      </Heading>
      <Text style={bodyStyle}>
        Your ContentRX {planLabel} subscription renews on {renewalDate}{" "}
        for {amountLabel}. This is a reminder, not a charge. Billing
        runs through Stripe on the renewal date.
      </Text>
      <Text style={bodyStyle}>
        Want to keep going? You don&apos;t need to do anything. Access
        continues without interruption.
      </Text>
      <Text style={bodyStyle}>
        Want to cancel or change your plan? Open the dashboard and
        manage your subscription in Stripe. Access continues through
        the end of your current paid period.
      </Text>
      <Text style={{ marginTop: 20 }}>
        <Button href={`${appUrl}/dashboard/settings`} style={primaryButton}>
          Manage subscription
        </Button>
      </Text>
    </EmailShell>
  );
}
