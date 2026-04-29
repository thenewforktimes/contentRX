/**
 * Post (or update) a sticky PR comment with engine-check findings.
 *
 * Reads JSONL from stdin (output of `npm run check:engine`),
 * formats a markdown summary, and writes one comment per PR. The
 * comment carries a hidden marker so a subsequent run on the same
 * PR updates the existing comment instead of stacking new ones.
 *
 * Used in CI only. Locally, the engine-check stdout is enough.
 *
 * Auth: GITHUB_TOKEN (populated automatically in workflow runs) +
 * the repo + PR number from GitHub env vars.
 *
 * Usage in a workflow:
 *
 *   npm run check:engine -- --diff > /tmp/findings.jsonl || rc=$?
 *   cat /tmp/findings.jsonl | tsx scripts/post-engine-check-comment.ts
 *   exit ${rc:-0}
 *
 * The exit-code propagation pattern preserves the engine check's
 * pass/fail signal even though the comment poster runs on top.
 */

import { exit, stderr, stdin } from "node:process";

type EngineFinding = {
  file: string;
  line: number;
  col: number;
  text: string;
  context: string;
  content_type_hint: string | null;
  moment_hint: string | null;
  verdict: "violation" | "review_recommended" | "pass" | "error";
  severity: "error" | "warning" | "info";
  violations: Array<{
    issue: string;
    suggestion: string;
    severity: string;
    confidence: number;
  }>;
  review_reason: string | null;
  latency_ms: number;
};

const COMMENT_MARKER = "<!-- contentrx-engine-check -->";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function parseFindings(raw: string): EngineFinding[] {
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as EngineFinding);
}

function truncate(s: string, max = 120): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function escapeTableCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function formatComment(findings: EngineFinding[]): string {
  const violations = findings.filter((f) => f.severity === "error");
  const reviews = findings.filter((f) => f.severity === "warning");

  const head =
    "## ContentRX engine check\n\n" +
    `${violations.length} violation${violations.length === 1 ? "" : "s"} · ` +
    `${reviews.length} review${reviews.length === 1 ? "" : "s"}.\n`;

  if (findings.length === 0) {
    return (
      head +
      "\nNothing to flag in the changed customer copy. Nice.\n\n" +
      COMMENT_MARKER
    );
  }

  const sections: string[] = [head];

  if (violations.length > 0) {
    sections.push("\n### Violations\n");
    sections.push(
      "| Location | Text | Issue | Suggestion |\n" +
        "|---|---|---|---|\n" +
        violations
          .flatMap((f) =>
            f.violations.length > 0
              ? f.violations.map((v) => formatRow(f, v))
              : [formatRow(f, null)],
          )
          .join("\n"),
    );
  }

  if (reviews.length > 0) {
    sections.push("\n### Worth a review\n");
    sections.push(
      "| Location | Text | Reason |\n" +
        "|---|---|---|\n" +
        reviews
          .map(
            (f) =>
              `| \`${f.file}:${f.line}\` | ${escapeTableCell(truncate(JSON.stringify(f.text)))} | ${escapeTableCell(f.review_reason ?? "—")} |`,
          )
          .join("\n"),
    );
  }

  sections.push(
    "\n_Powered by ContentRX checking ContentRX. " +
      "False positive? Drop a `// contentrx-ignore` comment near the line " +
      "(coming in PR 6) or override with a fresh commit._\n",
  );
  sections.push(`\n${COMMENT_MARKER}`);
  return sections.join("");
}

function formatRow(
  f: EngineFinding,
  v: EngineFinding["violations"][number] | null,
): string {
  const loc = `\`${f.file}:${f.line}\``;
  const text = escapeTableCell(truncate(JSON.stringify(f.text)));
  const issue = v ? escapeTableCell(v.issue) : "(no issue field)";
  const suggestion = v ? escapeTableCell(v.suggestion) : "—";
  return `| ${loc} | ${text} | ${issue} | ${suggestion} |`;
}

// -----------------------------------------------------------------------------
// GitHub API
// -----------------------------------------------------------------------------

type GhPrComment = {
  id: number;
  body: string;
};

async function ghRequest(
  path: string,
  method: "GET" | "POST" | "PATCH",
  token: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "contentrx-engine-check",
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(
      `GitHub ${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  }
  return res.json();
}

async function findExistingComment(
  repo: string,
  prNumber: string,
  token: string,
): Promise<GhPrComment | null> {
  // GitHub paginates issue comments at 30/page by default. We
  // bump to 100 and walk pages until we find our marker. Most PRs
  // have <100 comments total so the typical case is one request.
  let page = 1;
  for (;;) {
    const url = `/repos/${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`;
    const comments = (await ghRequest(url, "GET", token)) as GhPrComment[];
    if (comments.length === 0) return null;
    const found = comments.find((c) => c.body.includes(COMMENT_MARKER));
    if (found) return found;
    if (comments.length < 100) return null;
    page++;
  }
}

async function postOrUpdate(
  repo: string,
  prNumber: string,
  token: string,
  body: string,
): Promise<void> {
  const existing = await findExistingComment(repo, prNumber, token);
  if (existing) {
    await ghRequest(
      `/repos/${repo}/issues/comments/${existing.id}`,
      "PATCH",
      token,
      { body },
    );
    stderr.write(`Updated existing engine-check comment ${existing.id}.\n`);
  } else {
    await ghRequest(`/repos/${repo}/issues/${prNumber}/comments`, "POST", token, {
      body,
    });
    stderr.write("Posted new engine-check comment.\n");
  }
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  const repo = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const token = process.env.GITHUB_TOKEN;

  if (!repo || !eventPath || !token) {
    stderr.write(
      "post-engine-check-comment: missing GitHub workflow env. Skipping (this script is CI-only).\n",
    );
    exit(0);
  }

  // The PR number lives in the workflow event payload. For
  // pull_request events it's at .pull_request.number.
  const event = JSON.parse(
    (await import("node:fs")).readFileSync(eventPath, "utf-8"),
  ) as { pull_request?: { number?: number } };
  const prNumber = event.pull_request?.number;
  if (!prNumber) {
    stderr.write(
      "Not a pull_request event; nothing to comment on. Exiting.\n",
    );
    exit(0);
  }

  const raw = await readStdin();
  let findings: EngineFinding[];
  try {
    findings = parseFindings(raw);
  } catch (err) {
    stderr.write(
      `Couldn't parse JSONL on stdin: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    exit(2);
    return;
  }

  const body = formatComment(findings);
  await postOrUpdate(repo, String(prNumber), token, body);
  exit(0);
}

// CLI entry guard so tests can import without triggering main().
const invokedAsCli =
  import.meta.url === `file://${process.argv[1]}` ||
  (import.meta.url.endsWith("/post-engine-check-comment.ts") &&
    process.argv[1]?.endsWith("post-engine-check-comment.ts"));
if (invokedAsCli) {
  main().catch((err) => {
    stderr.write(
      `Unexpected: ${err instanceof Error ? err.stack : String(err)}\n`,
    );
    exit(2);
  });
}

// Public for tests.
export { formatComment, parseFindings, COMMENT_MARKER, truncate };
