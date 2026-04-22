/**
 * /auth/figma-callback — post-sign-in landing page for the Figma plugin flow.
 *
 * Runs as a Server Component so the entire handoff (user lookup, key
 * provisioning, Redis write) happens on the server before any HTML is sent
 * back to the browser. The user sees a static "you can close this tab" page;
 * the plugin polls /auth/figma?poll=1&handoff=<code> in parallel and picks
 * up the token as soon as this page has stashed it.
 *
 * Provisioning side-effect: if the Clerk-backed user row exists but has no
 * api_key yet, one is generated here (cx_<cuid2>). That's a deliberate
 * trade-off: the BUILD_PLAN ships dashboard-driven key management in
 * Session 9, and between now and then the plugin is the mint point. Keys
 * are stored plaintext — known limitation #1 in CLAUDE.md, scheduled for
 * Session 9 to rework as sha256(key) lookup.
 */

import { createId } from "@paralleldrive/cuid2";
import { auth } from "@clerk/nextjs/server";
import { clerkClient } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { getRedis } from "@/lib/redis";

const HANDOFF_PREFIX = "figma_handoff:";
const HANDOFF_TTL_SECONDS = 300;
const HANDOFF_RE = /^[A-Za-z0-9_-]{16,128}$/;

type PageProps = {
  searchParams: Promise<{ handoff?: string }>;
};

async function primaryEmail(clerkId: string): Promise<string | null> {
  const client = await clerkClient();
  const user = await client.users.getUser(clerkId);
  const primaryId = user.primaryEmailAddressId;
  const primary = user.emailAddresses.find((e) => e.id === primaryId);
  return (primary ?? user.emailAddresses[0])?.emailAddress ?? null;
}

async function ensureApiKey(clerkId: string): Promise<string> {
  const db = getDb();

  // Usual path: Clerk webhook has already created the users row.
  let [row] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.clerkId, clerkId))
    .limit(1);

  if (!row) {
    // Race: user just signed up and the webhook hasn't landed yet.
    // Insert a minimal row so the plugin isn't blocked on webhook latency.
    const email = (await primaryEmail(clerkId)) ?? `${clerkId}@unknown.local`;
    await db
      .insert(schema.users)
      .values({ clerkId, email, plan: "free" })
      .onConflictDoNothing({ target: schema.users.clerkId });
    [row] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.clerkId, clerkId))
      .limit(1);
  }

  if (!row) {
    throw new Error("Failed to provision user row");
  }

  if (row.apiKey) {
    return row.apiKey;
  }

  const newKey = `cx_${createId()}`;
  await db
    .update(schema.users)
    .set({ apiKey: newKey })
    .where(eq(schema.users.id, row.id));
  return newKey;
}

export default async function FigmaCallbackPage({ searchParams }: PageProps) {
  const { handoff } = await searchParams;

  if (!handoff || !HANDOFF_RE.test(handoff)) {
    return (
      <CallbackShell tone="error">
        <p>
          This sign-in link is missing or malformed. Open the Figma plugin
          again and click <strong>Sign in</strong> to start over.
        </p>
      </CallbackShell>
    );
  }

  const { userId: clerkId } = await auth();
  if (!clerkId) {
    // Shouldn't happen — /auth/figma already gated this — but bounce
    // through sign-in just in case a user opened the callback URL directly.
    const returnTo = `/auth/figma-callback?handoff=${encodeURIComponent(handoff)}`;
    redirect(`/sign-in?redirect_url=${encodeURIComponent(returnTo)}`);
  }

  let token: string;
  try {
    token = await ensureApiKey(clerkId);
  } catch (err) {
    console.error("figma-callback: ensureApiKey failed", err);
    return (
      <CallbackShell tone="error">
        <p>
          Something went wrong while setting up your account. Close this tab
          and try the Figma plugin&apos;s <strong>Sign in</strong> button again.
        </p>
      </CallbackShell>
    );
  }

  try {
    const redis = getRedis();
    await redis.set(HANDOFF_PREFIX + handoff, token, {
      ex: HANDOFF_TTL_SECONDS,
    });
  } catch (err) {
    console.error("figma-callback: redis set failed", err);
    return (
      <CallbackShell tone="error">
        <p>
          We couldn&apos;t complete the hand-off to the plugin. Try signing in
          from the plugin once more.
        </p>
      </CallbackShell>
    );
  }

  return (
    <CallbackShell tone="ok">
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 12 }}>
        You&apos;re signed in.
      </h1>
      <p>
        Head back to the Figma plugin — it&apos;s picking up your session now.
        You can close this tab.
      </p>
    </CallbackShell>
  );
}

function CallbackShell({
  tone,
  children,
}: {
  tone: "ok" | "error";
  children: React.ReactNode;
}) {
  const accent = tone === "ok" ? "#16a34a" : "#dc2626";
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        fontFamily:
          'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: 420,
          borderTop: `4px solid ${accent}`,
          padding: "24px 28px",
          borderRadius: 8,
          background: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          color: "#1f2937",
          lineHeight: 1.55,
        }}
      >
        {children}
      </div>
    </main>
  );
}
