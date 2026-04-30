#!/usr/bin/env bash
# Fetch the private substrate (standards_library.json + moments_taxonomy.json)
# into src/content_checker/standards/private/ so the engine + Next.js can
# load it.
#
# Why this script exists:
#   The substrate lives in a private GitHub repo per ADR 2026-04-25. Git
#   submodules would be the natural way to consume it, but Vercel's GitHub
#   App auto-clone does not pass its installation token through to submodule
#   fetches — submodule clones silently fail on every build. This script is
#   the workaround.
#
# Behavior:
#   - If the substrate is already present (file exists at the canonical
#     path), it's a no-op. Local devs who clone the substrate manually
#     are unaffected.
#   - If not present and SUBSTRATE_TOKEN is set, clone the private repo
#     using that token. This is the Vercel build path.
#   - If not present and no token, fail loudly with a pointer to the ADR
#     and the env-var name. Better than a confusing import error later.
#
# Vercel setup:
#   1. Create a fine-grained GitHub PAT with "Contents: Read" on
#      thenewforktimes/contentRX-substrate.
#   2. Add it to Vercel project env vars as SUBSTRATE_TOKEN
#      (Production + Preview scopes).
#
# Local dev setup:
#   git clone https://github.com/thenewforktimes/contentRX-substrate.git \
#     src/content_checker/standards/private

set -euo pipefail

SUBSTRATE_DIR="src/content_checker/standards/private"
SUBSTRATE_FILE="${SUBSTRATE_DIR}/standards_library.json"
SUBSTRATE_REPO="github.com/thenewforktimes/contentRX-substrate.git"

if [ -f "${SUBSTRATE_FILE}" ]; then
  echo "[substrate] Already present at ${SUBSTRATE_DIR}; skipping fetch."
  exit 0
fi

if [ -z "${SUBSTRATE_TOKEN:-}" ]; then
  cat >&2 <<EOF
[substrate] FATAL: ${SUBSTRATE_DIR} is missing and SUBSTRATE_TOKEN is not set.

Local dev: clone the substrate repo into the path manually:

  git clone https://github.com/thenewforktimes/contentRX-substrate.git \\
    ${SUBSTRATE_DIR}

CI/Vercel: set the SUBSTRATE_TOKEN env var to a GitHub PAT with read
access to thenewforktimes/contentRX-substrate.

Background: ADR 2026-04-25 (private taxonomy pivot). The substrate is
the editorial library; the engine loads it at runtime.
EOF
  exit 1
fi

# Empty-but-existing dir would block the clone; clear it.
if [ -d "${SUBSTRATE_DIR}" ]; then
  rm -rf "${SUBSTRATE_DIR}"
fi

echo "[substrate] Cloning ${SUBSTRATE_REPO} into ${SUBSTRATE_DIR}..."
# URL form: `https://oauth2:TOKEN@github.com/...`.
#
# Why oauth2 specifically: GitHub treats a few usernames specially.
# `x-access-token:TOKEN` is the auth path for GitHub App installation
# tokens — using it with a fine-grained user PAT triggers App-specific
# permission checks that fail with "Write access to repository not
# granted" even on read-only clones. `oauth2:TOKEN` is the standard
# username-as-placeholder form: any string works as the username when
# using a PAT as the password, and `oauth2` is the conventional choice
# that works for both fine-grained and classic PATs.
git clone --depth 1 --quiet \
  "https://oauth2:${SUBSTRATE_TOKEN}@${SUBSTRATE_REPO}" \
  "${SUBSTRATE_DIR}"

if [ ! -f "${SUBSTRATE_FILE}" ]; then
  echo "[substrate] FATAL: clone succeeded but ${SUBSTRATE_FILE} missing." >&2
  exit 1
fi

echo "[substrate] Fetched successfully."
