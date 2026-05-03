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
import { buttonStyles } from "@/components/ui/button";
import { getDb, schema } from "@/db";
import { apiKeyPrefix, generateApiKey, hashApiKey } from "@/lib/api-key";
import {
  FIGMA_HANDOFF_REDIS_PREFIX,
  FIGMA_HANDOFF_TTL_SECONDS,
  isValidHandoff,
} from "@/lib/figma-handoff";
import { getRedis } from "@/lib/redis";
import { revokeAndReSignIn } from "./actions";

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

/** Sentinel returned by ensureApiKey when the user already has a key.
 * Plugin sign-in shouldn't silently rotate other-session keys (audit H-02);
 * the user has to rotate explicitly from /dashboard if they really want
 * a new one. */
const HAS_EXISTING_KEY = Symbol("has-existing-key");
type EnsureKeyResult = string | typeof HAS_EXISTING_KEY;

async function ensureApiKey(clerkId: string): Promise<EnsureKeyResult> {
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
    const email = await primaryEmail(clerkId);
    if (!email) {
      // No email visible from Clerk's Backend API yet (eventual
      // consistency, network blip). Don't insert a synthetic
      // placeholder address — the email column has a UNIQUE constraint
      // and the placeholder would block a legitimate later insert for
      // the real address.
      throw new Error("Could not resolve email from Clerk");
    }
    // No target on the conflict clause — `users` has unique constraints
    // on BOTH clerk_id and email. Targeting only clerk_id used to throw
    // PostgresError: users_email_unique when this clerk_id collided
    // with a stale row under the same email (e.g., a prior signup that
    // never completed but did create a row). Bare onConflictDoNothing()
    // lets either conflict pass; the re-select below tells us whether
    // a row now exists for *our* clerk_id.
    await db
      .insert(schema.users)
      .values({ clerkId, email, plan: "free" })
      .onConflictDoNothing();
    [row] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.clerkId, clerkId))
      .limit(1);
  }

  if (!row) {
    // Most likely: an existing row claims this user's email under a
    // different clerk_id, so the insert silently no-op'd and the
    // re-select still finds nothing for our clerk_id. The caller
    // catches and renders a "try again" page; admin can resolve the
    // collision in the DB if it persists.
    throw new Error("Failed to provision user row");
  }

  // If the user already has a key, refuse to rotate it implicitly.
  // Closes audit H-02: silently rotating on every sign-in invalidated
  // CLI / GitHub Action sessions with no warning. The user needs to
  // explicitly rotate from /dashboard if they really want a new one.
  if (row.apiKeyHash) {
    return HAS_EXISTING_KEY;
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

  let result: EnsureKeyResult;
  try {
    result = await ensureApiKey(clerkId);
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

  // User already has an API key. We can't show it to them again (only the
  // hash is stored), and silently rotating it would break their CLI / GitHub
  // Action sessions (audit H-02). Two recovery paths:
  //   1. Inline "Revoke and sign in" — fastest path; revokes the existing
  //      key in this same flow, then re-mints + stashes for the plugin.
  //      Breaks any other sessions, but the user is consenting explicitly.
  //   2. Cancel and rotate from /dashboard — preserves the key for the
  //      user to manually paste into other sessions afterward (CLI,
  //      GitHub Action). Slower but doesn't strand other clients.
  if (result === HAS_EXISTING_KEY) {
    return (
      <CallbackShell tone="error">
        <h1 className="mb-3 text-2xl font-semibold">An API key already exists</h1>
        <p className="mb-3">
          You already have a ContentRX API key in use by your CLI, GitHub
          Action, or other sessions. Signing in from the Figma plugin
          can&apos;t recover it (we only store a hash).
        </p>
        <p className="mb-4">
          You can revoke the existing key now to complete plugin sign-in,
          or cancel and rotate from your dashboard if you need the new key
          in your CLI / GitHub Action too.
        </p>
        <form action={revokeAndReSignIn} className="mb-3">
          <input type="hidden" name="handoff" value={handoff} />
          <button
            type="submit"
            className={buttonStyles({ className: "w-full" })}
          >
            Revoke existing key and sign in to plugin
          </button>
        </form>
        <p className="text-xs text-stone-600 dark:text-stone-400">
          Revoking will immediately break any CLI or GitHub Action sessions
          using the old key. Prefer to rotate manually?{" "}
          <a href="/dashboard" className="underline">
            Cancel and go to dashboard
          </a>
          .
        </p>
      </CallbackShell>
    );
  }

  const token: string = result;

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
        Head back to the Figma plugin. It&apos;s picking up your session now.
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
        className={`w-full max-w-md rounded-lg border-t-4 bg-white px-7 py-6 leading-relaxed text-stone-800 shadow-sm dark:bg-stone-950 dark:text-stone-200 ${accentBorder}`}
      >
        {children}
      </div>
    </main>
  );
}
