# Next-session kickoff prompt

Copy-paste this as your first message in the new Claude Code session.

---

## Kickoff — Audit Wave 3 (UI + plugin polish)

We've cleared every Critical, High, and security/correctness Medium from the 2026-04-22 audit across waves 1 and 2. What's left is the UI polish bucket — 7 findings in `docs/code-audit-2026-04-22.md` §5. All of it is code-only, no external setup, no schema changes.

**This session's scope — Wave 3:**

- **UI-M-01** — Replace `confirm()` + `alert()` on destructive actions with an accessible AlertDialog component. Hit sites:
  - `src/app/dashboard/api-key-panel.tsx:60` (Revoke key)
  - `src/app/dashboard/team/rules/rules-client.tsx:268` (Remove custom rule)
  Tailwind-only, `role="alertdialog"`, focus trap, keyboard-dismissable.
- **UI-M-04** — `src/app/auth/figma-callback/page.tsx:156-197` uses inline hex colors (`#fff`, `#1f2937`) that ignore dark mode. Port to Tailwind `bg-white dark:bg-neutral-950` etc.
- **UI-M-05** — `src/app/dashboard/page.tsx:184` still shows a "DittoPanel" with a "Coming soon" label. Either hide it until Session 18 lands, or move to a collapsed `/dashboard/integrations` section.
- **UI-L-01** — `src/app/dashboard/api-key-panel.tsx:80-88` silently swallows navigator.clipboard failures. Add a visible "Copy failed — select the text above" fallback.
- **PLG-M-02** — `figma-plugin/ui.html:633` has `DEV_MODE = true`. Flip to `false` (or gate on a URL param / plugin-menu item) before Figma Community submission.
- **PLG-M-03** — `figma-plugin/ui.html:3413-3418` uses `innerHTML += banner + area.innerHTML` for the quota-exhausted banner. Rebuild as DOM nodes with `textContent` so escaping bugs can't hide.
- **PLG-L-01** — Plugin ARIA audit: node cards are `<div>` + click handler (should be `<button>`), progress bars missing `role="progressbar"` + `aria-valuenow`, icon-only "Go to layer" button missing `aria-label`, quota banner missing `role="alert"`. Incremental.

**Workflow per repo memory:**

1. Start by reading `docs/code-audit-2026-04-22.md` §3.1 (plugin) and §3.2 (UI) for the full context.
2. Check the two reference memories (`reference_session_snapshot.md`, `reference_shell_gotchas.md`) — they'll save you time on things I already learned the hard way.
3. Branch off `main` as `audit/fixes-wave-3`. Main is currently `main @ 273309b`.
4. One PR for the whole wave. Keep UI changes + plugin changes separate commits within the same PR so the diff is easy to review.
5. Tests + lint + build before commit. Plugin JS syntax-check via `new Function(scriptBlock)`.
6. Before merging, ask before pushing to prod — user runs `vercel --prod` (or authorizes me to).

**Out of scope for this session (do not expand):**

- BUILD_PLAN Sessions 5 / 13 / 14 / 18 / 19 / 20 / 21 — all blocked on user-side external setup. Don't start them without an explicit ask.
- Stripe activation — waiting on user to configure products + env vars in Vercel.
- Figma Community submit — needs human screenshots + 30s video.

**If the user wants a different direction, offer:** Session 19 (docs.contentrx.app spec site) as the best alternative — codeable independently, MDX generator pulls from `src/content_checker/standards/standards_library.json`, only blocks on the user creating a new Vercel project.

---

Start by reading CLAUDE.md, then confirm you have context on where we are before doing anything else.
