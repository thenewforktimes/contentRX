#!/bin/sh
# ContentRX GitHub Action entrypoint.
#
# Responsibilities:
#   1. Hand off to src/main.py, which does the real work (extract,
#      call contentrx, format + post the PR comment).
#   2. Translate the runner-injected env into the stable names main.py
#      expects.
#   3. Exit non-zero when the check should fail.
#
# The runner gives us GITHUB_WORKSPACE (the cloned repo), GITHUB_TOKEN
# (for PR comment posting), GITHUB_EVENT_PATH (the pull_request payload),
# and GITHUB_REPOSITORY (owner/repo). We pass them straight through.
set -e

cd "${GITHUB_WORKSPACE:-/github/workspace}"

export CONTENTRX_API_KEY="${CONTENTRX_API_KEY:?CONTENTRX_API_KEY is required}"
export CONTENTRX_API_URL="${CONTENTRX_API_URL:-}"
export CONTENTRX_STRICT="${CONTENTRX_STRICT:-false}"
export CONTENTRX_CONTENT_TYPE="${CONTENTRX_CONTENT_TYPE:-short_ui_copy}"
export CONTENTRX_PATHS="${CONTENTRX_PATHS:-**/*.{tsx,jsx,html}}"

exec python /action/src/main.py
