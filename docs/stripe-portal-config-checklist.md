# Stripe Customer Portal configuration checklist

Settings that must be enabled in the Stripe Dashboard for the
in-product billing flows to work. None of this is enforceable in
code — the Customer Portal configuration is the source of truth, and
the `/api/portal` `manage_seats` deep-link **errors at session
creation** if the Portal isn't configured to allow subscription
quantity updates.

Stripe Dashboard → **Settings → Billing → Customer Portal**.

---

## Required for the "Add a seat" flow (Members panel → invite path)

The Members panel's "Add a seat" button calls `/api/portal` with
`{ flow: "manage_seats" }`, which creates a portal session with
`flow_data.type = "subscription_update"` pointed at the owner's
active subscription. Stripe rejects that session unless:

- [ ] **Subscriptions → "Customers can update subscriptions"** is ON.
- [ ] **"Customers can change quantities"** is ON for the **Team**
      price (so seat count is adjustable). If the Team price isn't in
      the list of products the portal can switch to/update, add it.
- [ ] The Team price is a **licensed** (per-seat quantity) price, not
      metered — quantity updates only apply to licensed prices.
- [ ] Proration behavior is set deliberately (Stripe default is
      "create prorations"). Confirm it matches the intended billing
      story for mid-cycle seat additions.

**Verify:** as a Team owner with an active subscription, click
"Add a seat" on `/dashboard/members`. You should land directly on
the Stripe seat-quantity screen (not the portal home), and on
completion return to `/dashboard/members`.

**Fallback behavior:** if no active subscription is found for the
customer, `/api/portal` falls back to a plain portal session rather
than erroring — the CTA is never a hard dead-end. But if the Portal
config above is missing, Stripe errors on the `flow_data` session
itself and the button surfaces "Couldn't open billing to add a
seat." Fixing that is this checklist.

## Already relied upon (pre-existing)

- [ ] Cancellation enabled (CARL-compliant cancel-anytime path).
- [ ] Payment method update enabled.
- [ ] Invoice history enabled.

## Future additions

Document any new portal-dependent flow here with the exact Dashboard
toggle it needs, so it can be re-verified after a Stripe account or
config migration.
