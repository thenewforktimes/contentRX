import { Heading, Section, Text } from "@react-email/components";
import { EmailShell } from "./_shell";

/**
 * Founder alert when a user crosses their daily or monthly cost
 * threshold and `cost_pause_active` flips to true. The
 * threshold-evaluator's atomic UPDATE guard de-dupes re-pause
 * attempts so this fires at most once per crossing.
 */
export function CostPauseAlertEmail({
  userEmail,
  userId,
  dailySpendUsd,
  monthlySpendUsd,
  dailyThresholdUsd,
  monthlyThresholdUsd,
  trigger,
  appUrl,
}: {
  userEmail: string;
  userId: string;
  dailySpendUsd: number;
  monthlySpendUsd: number;
  dailyThresholdUsd: number;
  monthlyThresholdUsd: number;
  trigger: "daily" | "monthly";
  appUrl: string;
}) {
  return (
    <EmailShell
      preview={`Cost-pause: ${userEmail} crossed the ${trigger} threshold`}
    >
      <Heading as="h1" style={{ fontSize: 18, marginBottom: 12 }}>
        Cost-pause triggered for {userEmail}
      </Heading>
      <Text>
        The {trigger} cost threshold for this user was crossed. Their
        account is now paused; the next /api/check call returns 402
        until you Resume from /admin/costs.
      </Text>
      <Section style={{ marginTop: 16 }}>
        <Text style={{ fontWeight: 600, marginBottom: 4 }}>Spend</Text>
        <Text style={{ margin: 0 }}>
          Today: ${dailySpendUsd.toFixed(2)} of $
          {dailyThresholdUsd.toFixed(2)}.
        </Text>
        <Text style={{ margin: 0 }}>
          This month: ${monthlySpendUsd.toFixed(2)} of $
          {monthlyThresholdUsd.toFixed(2)}.
        </Text>
      </Section>
      <Text style={{ marginTop: 16 }}>User id: {userId}</Text>
      <Text>
        Resume or inspect at{" "}
        <a href={`${appUrl}/admin/costs`}>{appUrl}/admin/costs</a>.
      </Text>
    </EmailShell>
  );
}
