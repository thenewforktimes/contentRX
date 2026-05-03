/**
 * Shared layout + style primitives for every transactional email.
 *
 * Pulls colors from `src/lib/design-tokens.ts` so the brand stays in
 * sync with the web app. Uses the LIGHT palette unconditionally — most
 * email clients (Gmail web, Outlook desktop) don't reliably honor
 * `prefers-color-scheme: dark` inside the email body, so a consistent
 * light email is more reliable than a dark email that breaks on
 * Outlook. The web app's dark canonical experience and the email's
 * light canonical experience share the same accent palette so the
 * brand reads as one across surfaces.
 *
 * Exports both the `EmailShell` layout and shared style objects
 * (`primaryButton`, `headingStyle`, etc.) so individual templates
 * never inline hex values. Adding a new style? Add it here, not in
 * the template.
 */

import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";
import { tokens } from "@/lib/design-tokens";

const { surface, text, border, accent } = tokens.light;

const main: React.CSSProperties = {
  backgroundColor: surface.sunken,
  fontFamily:
    'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif',
  padding: "24px 0",
  color: text.default,
};

const card: React.CSSProperties = {
  backgroundColor: surface.raised,
  borderRadius: 8,
  padding: "32px",
  maxWidth: 560,
  margin: "0 auto",
  border: `1px solid ${border.default}`,
};

const footer: React.CSSProperties = {
  fontSize: 12,
  color: text.quiet,
  textAlign: "center",
  marginTop: 24,
};

/**
 * Shared text style primitives. Templates compose these so the type
 * scale stays consistent — a heading in welcome.tsx looks identical
 * to a heading in quota-warning.tsx.
 */
export const headingStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 600,
  color: text.strong,
  margin: "0 0 12px",
};

export const subheadingStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  color: text.strong,
  margin: "0 0 12px",
};

export const bodyStyle: React.CSSProperties = {
  fontSize: 14,
  color: text.default,
  lineHeight: "1.5",
  margin: "0 0 12px",
};

export const subStyle: React.CSSProperties = {
  fontSize: 13,
  color: text.quiet,
  margin: "0 0 4px",
};

export const captionStyle: React.CSSProperties = {
  fontSize: 12,
  color: text.quiet,
  margin: "0 0 4px",
};

/**
 * Primary CTA button. Uses the warm bronze brand accent so emails
 * read as ContentRX-branded, not as a generic black-rectangle CTA.
 */
export const primaryButton: React.CSSProperties = {
  backgroundColor: accent.primary.solid,
  color: accent.primary.onSolid,
  borderRadius: 6,
  padding: "10px 20px",
  fontWeight: 500,
  fontSize: 14,
  textDecoration: "none",
  display: "inline-block",
};

/**
 * Caution callout box. Used for "worth a look" / urgent-but-not-broken
 * sections in digest emails. Soft caution background + matching border.
 */
export const cautionBox: React.CSSProperties = {
  backgroundColor: accent.caution.soft,
  border: `1px solid ${accent.caution.border}`,
  borderRadius: 6,
  padding: 12,
  marginBottom: 8,
};

export function EmailShell({
  preview,
  children,
}: {
  preview: string;
  children: ReactNode;
}) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={card}>{children}</Container>
        <Section style={footer}>
          <Hr
            style={{
              border: "none",
              borderTop: `1px solid ${border.default}`,
              margin: "16px auto",
              maxWidth: 560,
            }}
          />
          <Text style={footer}>
            ContentRX. The content model for product copy.
          </Text>
        </Section>
      </Body>
    </Html>
  );
}
