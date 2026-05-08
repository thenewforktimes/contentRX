"use client";

/**
 * Opens Clerk's hosted account modal (email, password, 2FA, sessions)
 * inline. Earlier this was a `<Link href="/sign-in/account">` — that
 * route doesn't exist on this app, so the button 404'd. Clerk exposes
 * `openUserProfile()` on the imperative client, which renders the
 * same UI Clerk's account portal does without needing a dedicated
 * `/user-profile` route + `<UserProfile />` mount.
 */

import { useClerk } from "@clerk/nextjs";

export function ManageAccountButton() {
  const clerk = useClerk();
  return (
    <button
      type="button"
      onClick={() => clerk.openUserProfile()}
      className="inline-flex items-center rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
    >
      Manage account
    </button>
  );
}
