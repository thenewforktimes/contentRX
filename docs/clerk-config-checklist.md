# Clerk dashboard configuration checklist

Settings that must match across Clerk **Development** and
**Production** instances. None of this is enforceable in code — the
Clerk dashboard is the source of truth, and accidental edits or
instance migrations can drift it. Re-run this checklist after any
Clerk dashboard work.

---

## Application Name

- **Set to:** `ContentRX` (capital C, capital R, capital X)
- **Why:** appears in the Clerk widget header ("Sign in to
  ContentRX"), email templates, OAuth consent screens, and
  account-portal chrome. Lowercase or alternate-case versions
  read as off-brand on the surface a customer sees first.
- **Where:** Clerk dashboard → **Customization** → Application name
- **Verify:** load `/sign-in` and confirm the widget shows
  `Sign in to ContentRX`.

## Per-instance check

Run after any Clerk dashboard change:

- [ ] **Development instance:** Application Name = `ContentRX`
- [ ] **Production instance:** Application Name = `ContentRX`
- [ ] `/sign-in` widget header reads `Sign in to ContentRX`
      (load against the relevant instance)

## Future additions

When other Clerk-side config drifts from intent, document the
expected value here so it can be re-verified. Likely candidates:

- Custom localization for the default `Welcome back!` copy (Clerk
  Customization → Localization). Currently the default; revisiting
  this is a separate effort.
- Email template subject lines + sender display name.
- Allowed redirect / origin URLs across environments.
