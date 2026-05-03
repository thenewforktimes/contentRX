/**
 * Shared layout for every transactional email. Keeps typography +
 * footer consistent without forcing each template to import a dozen
 * primitives.
 *
 * Pulls colors from `src/lib/design-tokens.ts` so the brand stays in
 * sync with the web app. Uses the LIGHT palette unconditionally — most
 * email clients (Gmail web, Outlook desktop) don't reliably honor
 * `prefers-color-scheme: dark` inside the email body, so a consistent
 * light email is more reliable than a dark email that breaks on
 * Outlook. The web app's dark canonical experience and the email's
 * light canonical experience share the same accent palette so the
 * brand reads as one across surfaces.
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

const { surface, text, border } = tokens.light;

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
