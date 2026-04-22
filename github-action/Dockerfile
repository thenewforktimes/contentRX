FROM python:3.11-slim

# ---------------------------------------------------------------------------
# Base tooling: bash + Node.js. Node is needed for the Babel-based AST
# extractor; python for contentrx-cli + the orchestrator. Everything is
# apt-installed so we don't carry a custom base image.
# ---------------------------------------------------------------------------
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /action

# Install contentrx-cli from PyPI. Pinned floor so the action doesn't
# silently break if the CLI ships an incompatible major.
RUN pip install --no-cache-dir "contentrx-cli>=0.1.0,<1.0"

# Install the extractor's Node dependencies. Do this BEFORE copying src/
# so a pure src/ edit doesn't invalidate the npm-install cache layer.
COPY src/package.json /action/src/package.json
RUN cd /action/src \
    && npm install --omit=dev --no-audit --no-fund

# Now copy the rest of the source.
COPY src/ /action/src/
COPY entrypoint.sh /action/entrypoint.sh
RUN chmod +x /action/entrypoint.sh /action/src/extract.mjs

ENTRYPOINT ["/action/entrypoint.sh"]
