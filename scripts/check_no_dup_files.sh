#!/usr/bin/env bash
# Guard against Finder / iCloud / Dropbox-style space-suffixed
# duplicate files.
#
# This machine's sync stack (suspected iCloud Drive on ~/Desktop)
# periodically creates shadow copies of existing files with a space +
# number suffix — `page 2.tsx`, `schema 2.ts`, `claude/staging 2`,
# etc. These break two things:
#
#   1. TypeScript builds. The duplicates aren't tracked in git but
#      tsc type-checks the whole working tree, so `npm run build`
#      fails with errors pointing at files you didn't edit.
#   2. `git fetch`. When the dups land in `.git/refs/heads/`,
#      `git fetch` bails with "bad object refs/heads/<name> N".
#
# The fix is always the same: delete them.
#
# This script:
#   - Finds space-named files anywhere in the repo (working tree +
#     .git/refs) that aren't under node_modules / .next / .venv /
#     .vercel / .pytest_cache.
#   - Exits 0 when clean, 1 when any are found.
#   - Prints the list + the exact `find -delete` command to fix it.
#
# Wired as `prebuild` in package.json (parent + docs-site) so it
# runs before every TypeScript build. Also runs in CI via
# `.github/workflows/no_dup_files.yml` as defence in depth.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

# Build the find command once; reused for both the check and the
# fix-message.
#
# Both `.venv/` (canonical per CLAUDE.md) AND `venv/` (accidental
# variant — discovered at `tools/venv/` post-PR#77) are excluded.
# Virtualenv contents are library files with their own naming
# hygiene; we match the gitignore convention instead of policing
# them.
FIND_EXCLUDES=(
  -not -path './.git/objects/*'
  -not -path './.git/logs/*'
  -not -path '*/node_modules/*'
  -not -path '*/.next/*'
  -not -path '*/.venv/*'
  -not -path '*/venv/*'
  -not -path '*/.vercel/*'
  -not -path '*/.pytest_cache/*'
  -not -path '*/__pycache__/*'
  -not -path '*/dist/*'
)

# The working tree + .git/refs under one find so refs-corruption
# cases (`staging 10`, `staging 11`, …) show up alongside source
# duplicates (`page 2.tsx`).
dups=$(find . -type f -name '* *' "${FIND_EXCLUDES[@]}" 2>/dev/null || true)

if [[ -z "${dups:-}" ]]; then
  exit 0
fi

echo "❌ Space-suffixed duplicate files detected:" >&2
echo >&2
echo "${dups}" | sed 's|^\./|  |' >&2
echo >&2
echo "These are shadow copies created by Finder / iCloud Drive / Dropbox." >&2
echo "They aren't tracked in git but break TypeScript builds + git fetch." >&2
echo >&2
echo "Fix:" >&2
echo "  find . -type f -name '* *' \\" >&2
echo "    -not -path './.git/objects/*' -not -path './.git/logs/*' \\" >&2
echo "    -not -path '*/node_modules/*' -not -path '*/.next/*' \\" >&2
echo "    -not -path '*/.venv/*' -not -path '*/venv/*' \\" >&2
echo "    -not -path '*/.vercel/*' -not -path '*/.pytest_cache/*' \\" >&2
echo "    -not -path '*/__pycache__/*' -not -path '*/dist/*' \\" >&2
echo "    -delete" >&2
echo >&2
echo "Root-cause: check iCloud Drive / Dropbox / OneDrive sync on your repo path." >&2
exit 1
