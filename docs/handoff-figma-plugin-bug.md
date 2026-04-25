# Handoff: Figma plugin renders blank — investigation continued

**Created:** 2026-04-25, end of an exhausted multi-PR session at ~900k context.
**Status:** Open. Investigation tabled to a fresh Claude Code session.

The prompt below is what the next session should be given as its
opening message. It instructs the next-Claude to read all build
documentation comprehensively before touching any code, and points
at the saved memory note that contains the full state at handoff.

---

## Prompt for the next session

```
Read every single word of build documentation in this repo before
investigating anything. The Figma plugin renders as a blank black
iframe on Robert's Mac and we need to find why.

Required reading (in this order):

1. /Users/rbxnoodle/.claude/projects/-Users-rbxnoodle-Desktop-contentRX/memory/MEMORY.md
   — index of saved context. Then read every linked memory file,
   especially:
   - project_figma_plugin_blank_screen_bug.md
     (the full state at handoff: what's ruled out, what's confirmed
     working, suspected causes, repro steps)
   - feedback_git_workflow.md
   - reference_shell_gotchas.md

2. /Users/rbxnoodle/Desktop/contentRX/CLAUDE.md
   (root project instructions — locked decisions, what not to do)

3. /Users/rbxnoodle/Desktop/contentRX/BUILD_PLAN_v2.md
   (canonical build plan)

4. /Users/rbxnoodle/Desktop/contentRX/docs/code-audit-2026-04-24.md
   (the 13-PR audit doc — covers every recent change end-to-end)

5. Every sub-surface CLAUDE.md, in full:
   - figma-plugin/ (any README/CLAUDE there)
   - github-action/CLAUDE.md
   - mcp-server/CLAUDE.md
   - lsp-server/CLAUDE.md (if exists)
   - cli-client/ (any docs)

6. Scan but don't deep-read:
   - docs/build-plan-v1-archive.md
   - docs/progress-story-2026-04-23.md
   - docs/architecture-diagram.md
   - docs/account-setup-checklist.md
   - docs/figma-community-submission.md
   - docs/API_VERSIONING.md
   - docs/HELD_OUT_GATE.md

After reading, before touching code:

a. Confirm you've internalized that the prior session ALREADY
   ruled out: PR 6 (#98) being the cause, JS syntax errors in
   ui.html or code.js, the Figma platform itself (a 10-line
   diagnostic plugin at ~/Desktop/figma-test-plugin/ works fine),
   and any backend involvement (vercel logs are empty during the
   failure window).

b. Form a hypothesis BEFORE touching anything. The repro is in
   the memory note.

c. The next-step suggestions in the memory note are: bisect older
   commits via `git checkout <commit> -- figma-plugin/` to find
   when it actually broke, and compare structurally against the
   working diagnostic plugin at ~/Desktop/figma-test-plugin/.
   Do not assume those are the only options — they're starting
   points.

d. Check in with Robert before running destructive ops or before
   spending more than 30 minutes down a single rabbit hole.

The goal is to find what makes our plugin's UI iframe stay blank
while a minimal diagnostic plugin renders correctly. Working tree
is clean (figma-plugin/ at HEAD = current main). Don't trust this
prompt to be exhaustive — read the actual files.
```

---

## How to use this doc

In the new session, paste the prompt block above as your first
message. The next session will read the memory note for the full
investigation state, the code-audit doc for what was changed
recently, and the project CLAUDE.md files for the locked
architectural decisions before forming a hypothesis.
