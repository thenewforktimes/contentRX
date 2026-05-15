#!/usr/bin/env bash
# Bootstrap a fresh contentRX clone for local development.
#
# Idempotent — safe to re-run. Doesn't touch the SUBSTRATE_TOKEN-based
# fetch path (scripts/fetch-substrate.sh is for Vercel/CI). This script
# is the local-dev companion: it uses the `gh` CLI's existing auth so
# devs don't have to mint a PAT just to clone the substrate.
#
# Order:
#   1. Substrate (gh clone)
#   2. .env.local sanity (warn if production keys are sitting in local env)
#   3. Optional gitignored data file inventory
#   4. node_modules
#
# Motivated by the 2026-05-12 iCloud disaster recovery: a fresh clone
# without the substrate, with a recovered .env.local that still had
# production Clerk keys, hit four separate failure modes before
# `npm run dev` would start. This script catches all of them up front.

set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> contentRX bootstrap"

# 1. Substrate
SUBSTRATE_DIR="src/content_checker/standards/private"
SUBSTRATE_FILE="${SUBSTRATE_DIR}/standards_library.json"
SUBSTRATE_REPO="thenewforktimes/contentRX-substrate"

if [[ -f "${SUBSTRATE_FILE}" ]]; then
  echo "  [substrate] present at ${SUBSTRATE_DIR}"
elif [[ -d "${SUBSTRATE_DIR}" && ! -d "${SUBSTRATE_DIR}/.git" ]]; then
  echo "  [substrate] ERROR: ${SUBSTRATE_DIR} exists but is not a git clone." >&2
  echo "  Move or remove it, then re-run bootstrap." >&2
  exit 1
elif command -v gh >/dev/null 2>&1; then
  echo "  [substrate] cloning ${SUBSTRATE_REPO} → ${SUBSTRATE_DIR}"
  gh repo clone "${SUBSTRATE_REPO}" "${SUBSTRATE_DIR}"
else
  echo "  [substrate] ERROR: gh CLI not found, and ${SUBSTRATE_FILE} is missing." >&2
  echo "  Install gh: https://cli.github.com" >&2
  echo "  Or clone manually:" >&2
  echo "    git clone https://github.com/${SUBSTRATE_REPO} ${SUBSTRATE_DIR}" >&2
  exit 1
fi

# 2. .env.local sanity. Count occurrences only — never echo values.
# Past sessions have leaked secrets via redaction-regex pipelines that
# silently failed; the safer move is to never put secret-bearing files
# through any transform that could surface a value in stdout.
ENV_FILE=".env.local"
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "  [env] ${ENV_FILE} not found — copy .env.local.example and fill in dev keys"
else
  # Anchored at line start so values appearing as substrings inside
  # other env vars (URLs, comments) don't trigger false positives.
  PROD_KEYS=$(grep -cE '^[A-Z_]+="?(pk_live_|sk_live_)' "${ENV_FILE}" || true)
  if [[ "${PROD_KEYS}" -gt 0 ]]; then
    echo "  [env] WARNING: ${ENV_FILE} contains ${PROD_KEYS} production-key line(s)."
    echo "        Production keys (pk_live_ / sk_live_) belong only in Vercel."
    echo "        Replace with pk_test_ / sk_test_ from the Clerk Development instance."
    echo "        (No values echoed — line count only.)"
  else
    echo "  [env] ${ENV_FILE} has no production keys"
  fi
fi

# 3. Gitignored data files. Admin surfaces empty-state when these are
# missing (verified in the 2026-05-14 site walk); listing them here
# just so you know what shape the surfaces will take.
echo "  [data] gitignored files (admin surfaces empty-state if absent):"
for path in evals/graduation/readiness.json reports/accuracy/latest.json taxonomy_refinement_log.md; do
  if [[ -f "${path}" ]]; then
    echo "    + ${path}"
  else
    echo "    - ${path} (missing — fine, surfaces will empty-state)"
  fi
done

# 4. Node deps
if [[ ! -d "node_modules" ]]; then
  echo "  [deps] node_modules missing — running npm install"
  npm install
else
  echo "  [deps] node_modules present (re-run npm install if package.json changed)"
fi

echo
echo "==> bootstrap complete"
echo "   Next: npm run dev"
