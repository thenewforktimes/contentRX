import { headers } from "next/headers";
import { Webhook } from "svix";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getRedis } from "@/lib/redis";
import { trackEvent } from "@/lib/analytics";
import { appUrl, sendEmail } from "@/lib/email";
import { requireEnv } from "@/lib/require-env";
import { logSafeError } from "@/lib/safe-error-log";
import { WelcomeEmail } from "@/emails/welcome";

const DEDUPE_PREFIX = "clerk_event:";
const DEDUPE_TTL_SECONDS = 24 * 60 * 60;

type ClerkUserEvent = {
  type: "user.created" | "user.updated" | "user.deleted";
  data: {
    id: string;
    email_addresses?: { email_address: string; id: string }[];
    primary_email_address_id?: string | null;
  };
};

function primaryEmail(data: ClerkUserEvent["data"]): string | null {
  const list = data.email_addresses ?? [];
  if (list.length === 0) return null;
  const primary = list.find((e) => e.id === data.primary_email_address_id);
  return (primary ?? list[0]).email_address;
}

export async function POST(req: Request) {
  // requireEnv throws on missing OR empty — Next.js catches → 500 + Sentry.
  // Replaces the previous `if (!secret) return 500` which swallowed empty-
  // string env vars silently (the actual prod incident on 2026-04-24).
  const secret = requireEnv("CLERK_WEBHOOK_SECRET");

  const hdrs = await headers();
  const svixId = hdrs.get("svix-id");
  const svixTimestamp = hdrs.get("svix-timestamp");
  const svixSignature = hdrs.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return Response.json(
      { error: "Missing svix signature headers" },
      { status: 400 },
    );
  }

  const body = await req.text();
  const wh = new Webhook(secret);

  let evt: ClerkUserEvent;
  try {
    evt = wh.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkUserEvent;
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Svix verification validates signature + 5-minute timestamp window,
  // but within that window the same event can replay. Earlier we set the
  // dedupe key BEFORE running any work, which silently dropped retries
  // when the first attempt crashed mid-flight (incident on 2026-04-25:
  // user.created retried after a timeout, dedupe short-circuited the
  // retry, no users row created, dashboard dead-ended).
  //
  // The DB writes below are all idempotent (onConflictDoNothing on
  // insert, by-id update on update, by-id delete on delete). They are
  // safe to re-run on every retry. The dedupe key is now scoped to the
  // *side effects* (welcome email, analytics) where re-firing actually
  // matters, and is set only after they have been attempted.
  async function shouldFireSideEffects(): Promise<boolean> {
    try {
      const redis = getRedis();
      const setResult = await redis.set(DEDUPE_PREFIX + svixId, "1", {
        nx: true,
        ex: DEDUPE_TTL_SECONDS,
      });
      return setResult !== null;
    } catch (err) {
      // Redis outage shouldn't drop valid webhooks. Fire side effects;
      // the worst case is a duplicate welcome email, which beats no
      // welcome email at all.
      logSafeError("[clerk-webhook] dedupe lookup failed, firing anyway", err);
      return true;
    }
  }

  const db = getDb();

  if (evt.type === "user.created") {
    const email = primaryEmail(evt.data);
    if (!email) {
      return Response.json({ error: "No email on user" }, { status: 400 });
    }
    // No target on the conflict clause — `users` has unique constraints
    // on both `clerk_id` and `email`. Targeting only clerk_id (as the
    // earlier code did) caused PostgresError: users_email_unique to
    // bubble up when a stale row with this email existed under a
    // different clerk_id (e.g., from a prior test signup). Bare
    // onConflictDoNothing() lets either conflict pass; in the email-
    // conflict case the new clerk identity simply doesn't get a
    // users row, and the user lands on the "finishing setting up"
    // placeholder in the dashboard until the conflict is resolved.
    await db
      .insert(schema.users)
      .values({
        clerkId: evt.data.id,
        email,
        plan: "free",
      })
      .onConflictDoNothing();

    // Side-effects: welcome email + signup analytics. Gated by the
    // dedupe key so a Clerk retry doesn't double-send the welcome.
    // Both are best-effort — a failure here doesn't fail the webhook.
    if (await shouldFireSideEffects()) {
      const base = appUrl();
      await Promise.allSettled([
        sendEmail({
          to: email,
          subject: "Welcome to ContentRX",
          react: WelcomeEmail({
            appUrl: base,
          }),
        }),
        trackEvent("signup", {
          userId: evt.data.id,
          forwardedFor: hdrs.get("x-forwarded-for"),
          props: { plan: "free" },
        }),
      ]);
    }

    return Response.json({ ok: true });
  }

  if (evt.type === "user.updated") {
    const email = primaryEmail(evt.data);
    if (email) {
      await db
        .update(schema.users)
        .set({ email })
        .where(eq(schema.users.clerkId, evt.data.id));
    }
    return Response.json({ ok: true });
  }

  if (evt.type === "user.deleted") {
    await db
      .delete(schema.users)
      .where(eq(schema.users.clerkId, evt.data.id));
    return Response.json({ ok: true });
  }

  return Response.json({ ok: true });
}
