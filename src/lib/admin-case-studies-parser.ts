/**
 * Pure-logic helpers for `admin-case-studies.server.ts`.
 *
 * Extracted into a non-server module so vitest can exercise them
 * without tripping `server-only`'s import-time throw. Same pattern
 * as `admin-refinement-log-parser.ts`.
 */

/** Extract the first paragraph after the H1 from README, dropping
 * blank lines and admin metadata blocks (lines starting with `**` or
 * `- **`). Returns null when no real paragraph is found. */
export function extractDescription(readme: string): string | null {
  const lines = readme.split("\n");
  let inMeta = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim().startsWith("# ")) continue; // H1
    if (line.trim().startsWith("##")) break; // hit a section heading
    if (line.startsWith("- **") || line.startsWith("**")) {
      inMeta = true;
      continue;
    }
    if (inMeta && line.trim() === "") {
      inMeta = false;
      continue;
    }
    if (line.trim() === "") continue;
    if (inMeta) continue;
    // First real paragraph line — collect until blank line or section.
    const paragraph: string[] = [line.trim()];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]!;
      if (next.trim() === "") break;
      if (next.trim().startsWith("##")) break;
      paragraph.push(next.trim());
    }
    return paragraph.join(" ");
  }
  return null;
}

/** Pull the repo URL from a `**Repo:** \`<url>\`` line in the README.
 * Returns null when no such line is present. */
export function extractRepo(readme: string): string | null {
  const m = readme.match(/\*\*Repo:\*\*\s*`([^`]+)`/);
  return m ? m[1]! : null;
}
