/* eslint-disable react/no-unescaped-entities */
/**
 * Internal notification email sent to the ContentRX founder whenever a
 * geo-blocked visitor signs up to the waitlist. Recipient is the
 * founder, not the customer. Customers don't get a confirmation email
 * at launch — the on-page "got it" state is the confirmation. Switch
 * to a customer-facing confirmation if and when the waitlist captures
 * enough signups to justify a proper Resend audience.
 */

import { Heading, Text } from "@react-email/components";
import { EmailShell, bodyStyle, headingStyle } from "./_shell";

export function WaitlistSignupEmail({
  email,
  region,
  userAgent,
  submittedAt,
}: {
  email: string;
  region: string;
  userAgent: string;
  submittedAt: string;
}) {
  return (
    <EmailShell
      preview={`Waitlist signup from ${region || "unknown region"}`}
    >
      <Heading as="h1" style={headingStyle}>
        New waitlist signup
      </Heading>
      <Text style={bodyStyle}>
        Someone from a geo-blocked region just dropped their email on
        the ContentRX waitlist page.
      </Text>
      <Text style={bodyStyle}>
        <strong>Email.</strong> {email}
        <br />
        <strong>Region.</strong> {region || "(none detected)"}
        <br />
        <strong>User agent.</strong> {userAgent}
        <br />
        <strong>Submitted at.</strong> {submittedAt}
      </Text>
      <Text style={bodyStyle}>
        When ContentRX opens this region, drop them a note. The
        commitment on the public waitlist page is "we'll email you
        when access opens in your region," so the inbound demand
        signal carries an outbound obligation.
      </Text>
    </EmailShell>
  );
}
