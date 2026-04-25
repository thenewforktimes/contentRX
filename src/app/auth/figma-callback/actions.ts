"use server";

/**
 * Server actions for /auth/figma-callback.
 *
 * `revokeAndReSignIn` is the inline recovery path for the
 * "An API key already exists" branch — the user explicitly consents
 * to invalidating any existing CLI / GitHub Action sessions in
 * exchange for the Figma plugin completing its handoff. The action
 * clears the apiKeyHash/Prefix/CreatedAt columns and redirects back
 * to the same callback URL, where ensureApiKey will now mint a fresh
 * key and stash it in Redis for the plugin to pick up.
 */

import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { isValidHandoff } from "@/lib/figma-handoff";

export async function revokeAndReSignIn(formData: FormData) {
  const handoff = formData.get("handoff");
  if (typeof handoff !== "string" || !isValidHandoff(handoff)) {
    // Malformed handoff — bouncing back to the callback URL with no
    // handoff would surface the standard "missing or malformed" error.
    redirect("/auth/figma-callback");
  }

  const { userId: clerkId } = await auth();
  if (!clerkId) {
    const returnTo = `/auth/figma-callback?handoff=${encodeURIComponent(handoff)}`;
    redirect(`/sign-in?redirect_url=${encodeURIComponent(returnTo)}`);
  }

  // Clear the API key columns. Note: nulling the hash/prefix is the
  // explicit revoke action — any in-flight requests using the old key
  // will start failing 401 immediately. The user has been warned in
  // the page copy that this breaks other sessions.
  const db = getDb();
  await db
    .update(schema.users)
    .set({
      apiKeyHash: null,
      apiKeyPrefix: null,
      apiKeyCreatedAt: null,
    })
    .where(eq(schema.users.clerkId, clerkId));

  // Re-enter the callback with the same handoff. ensureApiKey now sees
  // a row with no apiKeyHash and follows the mint-and-stash path,
  // landing the user on the success page and unblocking the plugin's
  // poll on /auth/figma?poll=1&handoff=...
  redirect(`/auth/figma-callback?handoff=${encodeURIComponent(handoff)}`);
}
