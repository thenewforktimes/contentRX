/**
 * docs-site prebuild — duplicate-file guard.
 *
 * Post-pivot (ADR 2026-04-25): the docs site no longer renders the
 * standards library or moment taxonomy by name, so the prebuild no
 * longer copies substrate JSON into `docs-site/lib/`. The
 * Finder/iCloud duplicate-file guard stays — it's a hygiene check
 * shared with the parent app's prebuild and protects every build,
 * substrate or otherwise.
 */

import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

// Guard against Finder / iCloud space-suffixed duplicate files.
try {
  execSync("bash scripts/check_no_dup_files.sh", {
    cwd: repoRoot,
    stdio: "inherit",
  });
} catch (err) {
  process.exit(err.status ?? 1);
}
