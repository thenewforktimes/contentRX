/**
 * Shared layout for every transactional email. Keeps typography +
 * footer consistent without forcing each template to import a dozen
 * primitives.
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

const main: React.CSSProperties = {
  backgroundColor: "#f5f5f5",
  fontFamily:
    'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif',
  padding: "24px 0",
};

const card: React.CSSProperties = {
  backgroundColor: "#ffffff",
  borderRadius: 8,
  padding: "32px",
  maxWidth: 560,
  margin: "0 auto",
};

const footer: React.CSSProperties = {
  fontSize: 12,
  color: "#777777",
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
          <Hr style={{ border: "none", borderTop: "1px solid #e5e5e5", margin: "16px auto", maxWidth: 560 }} />
          <Text style={footer}>
            ContentRX — the content model for product copy.
          </Text>
        </Section>
      </Body>
    </Html>
  );
}
