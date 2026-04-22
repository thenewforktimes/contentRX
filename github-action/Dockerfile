FROM python:3.11-slim

# Minimal image: contentrx-cli (from PyPI) + the action's extractor + reporter.
# We don't need anything else — PR comment posting uses the standard
# `curl`/`urllib` approach against the GitHub API with GITHUB_TOKEN.

WORKDIR /action

# Install contentrx-cli from PyPI. Pinned floor so the action doesn't
# silently break if the CLI ships an incompatible major.
RUN pip install --no-cache-dir "contentrx-cli>=0.1.0,<1.0"

# Copy the action source after the pip install so CLI upgrades don't
# invalidate the source layer and vice versa.
COPY src/ /action/src/
COPY entrypoint.sh /action/entrypoint.sh
RUN chmod +x /action/entrypoint.sh

ENTRYPOINT ["/action/entrypoint.sh"]
