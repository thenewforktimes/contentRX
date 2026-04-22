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
 * api_key hash yet, one is generated here (cx_<cuid2>) and we persist
 * only sha256(raw) + the display prefix. The raw value is handed to the
 * plugin once via the Redis handoff and never written to disk.
 */

import { auth } from "@clerk/nextjs/server";
import { clerkClient } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { apiKeyPrefix, generateApiKey, hashApiKey } from "@/lib/api-key";
import {
  FIGMA_HANDOFF_REDIS_PREFIX,
  FIGMA_HANDOFF_TTL_SECONDS,
  isValidHandoff,
} from "@/lib/figma-handoff";
import { getRedis } from "@/lib/redis";

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

  // If the user already has a key, we can't show it to them again — the
  // raw value isn't stored. Mint a fresh one and overwrite. Rotation is
  // the user-visible path for this; here it's automatic because the
  // alternative (returning nothing) would break the plugin's sign-in.
  if (row.apiKeyHash) {
    const existingKey = generateApiKey();
    await db
      .update(schema.users)
      .set({
        apiKeyHash: hashApiKey(existingKey),
        apiKeyPrefix: apiKeyPrefix(existingKey),
        apiKeyCreatedAt: new Date(),
      })
      .where(eq(schema.users.id, row.id));
    return existingKey;
  }

  const newKey = generateApiKey();
  await db
    .update(schema.users)
    .set({
      apiKeyHash: hashApiKey(newKey),
      apiKeyPrefix: apiKeyPrefix(newKey),
      apiKeyCreatedAt: new Date(),
    })
    .where(eq(schema.users.id, row.id));
  return newKey;
}

export default async function FigmaCallbackPage({ searchParams }: PageProps) {
  const { handoff } = await searchParams;

  if (!isValidHandoff(handoff)) {
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
    await redis.set(FIGMA_HANDOFF_REDIS_PREFIX + handoff, token, {
      ex: FIGMA_HANDOFF_TTL_SECONDS,
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
      <h1 className="mb-3 text-2xl font-semibold">You&apos;re signed in.</h1>
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
  const accentBorder =
    tone === "ok" ? "border-t-green-600" : "border-t-red-600";
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div
        className={`w-full max-w-md rounded-lg border-t-4 bg-white px-7 py-6 leading-relaxed text-neutral-800 shadow-sm dark:bg-neutral-950 dark:text-neutral-200 ${accentBorder}`}
      >
        {children}
      </div>
    </main>
  );
}
