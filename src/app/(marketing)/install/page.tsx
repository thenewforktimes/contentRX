/**
 * /install — per-surface install instructions.
 *
 * 2026-05-11 polish pass. Robo's review: page hadn't been touched
 * in a while, content density too high, "Surface 1 / 2 / 3" eyebrow
 * numbering added chrome, and three surfaces (GitHub Action,
 * Figma plugin, VS Code Marketplace) needed coming-soon callouts
 * because their public marketplace listings haven't shipped yet.
 *
 * Cuts:
 *   - PageHeader lede + meta tightened (~130 → ~40 words).
 *   - Dashboard body cut from ~100 + code + 50 to ~30 (the 3-step
 *     sign-in code block was stating the obvious; the trailing
 *     "calibrated for product writing" paragraph lives on /pricing
 *     FAQ + /writes).
 *   - MCP / LSP / CLI / Action / Figma bodies cut to one-liners.
 *   - "Stacking surfaces" closer cut entirely. /accuracy +
 *     /dashboard cross-links survive in a tight foot line.
 *   - Internal plumbing references dropped: tool names from MCP
 *     prose, /api/suggest-fix from LSP prose.
 *
 * Surface order matches the home page's SurfacesGrid:
 *   1. Dashboard          (no install — lowest-friction try)
 *   2. MCP server         (available)
 *   3. LSP server         (available; VS Code Marketplace coming soon)
 *   4. CLI                (available)
 *   5. GitHub Action      (Marketplace listing coming soon)
 *   6. Figma plugin       (Community publication coming soon)
 *
 * "Surface N" eyebrow numbering dropped 2026-05-11. The chip-nav
 * + section ordering carry the sequence; numbers added nothing.
 *
 * Voice: short declarative, no em dashes, no semicolons, no colons.
 * Verb-led where the section content allows.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { Section } from "@/components/ui/section";

export const metadata: Metadata = {
  title: "Install. ContentRX",
  description:
    "Install ContentRX for Claude Code, Cursor, any LSP editor, your CLI, GitHub Actions, or Figma. Or skip the install and paste in the dashboard.",
};

export default function InstallPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <PageHeader
        eyebrow="Install"
        title="Five surfaces, one content model."
        lede={
          <>
            Pick the surfaces your team writes in. Or skip the install
            and{" "}
            <Link href="/dashboard/explain" className="underline underline-offset-2">
              paste your writing in the dashboard
            </Link>
            .
          </>
        }
        meta={
          <>
            Same engine, every surface. One{" "}
            <Link
              href="/dashboard"
              className="underline underline-offset-2"
            >
              API key
            </Link>
            {" "}covers them all.
          </>
        }
      >
        <nav className="mt-6 flex flex-wrap gap-2 text-sm">
          <SurfaceChip href="#paste" label="Dashboard" tagline="no install" />
          <SurfaceChip href="#mcp" label="MCP" tagline="Claude Code · Cursor" />
          <SurfaceChip href="#action" label="GitHub Action" tagline="PR gate" />
          <SurfaceChip href="#cli" label="CLI" tagline="contentrx" />
          <SurfaceChip href="#lsp" label="LSP" tagline="VS Code · Cursor · Zed" />
          <SurfaceChip href="#figma" label="Figma plugin" tagline="design-time" />
        </nav>
      </PageHeader>

      <Section
        id="paste"
        eyebrow="No install"
        title="Dashboard. Sign in, paste, get the review"
      >
        <p>
          Sign in and paste. Same engine, no install. Get the
          document-level read, a clean rewrite, and the flag list.
        </p>
      </Section>

      <Section id="mcp" title="MCP server. Claude Code, Cursor, any MCP client">
        <p>
          Inline check during generation. The LLM names the context,
          calls the verdict, suggests a rewrite. All in the same
          conversation.
        </p>
        <p className="mt-3">Claude Code:</p>
        <Code>{`claude mcp add contentrx -- uvx contentrx-mcp`}</Code>
        <p className="mt-3">Any MCP client (stdio):</p>
        <Code>
          {`export CONTENTRX_API_KEY=cx_...
uvx contentrx-mcp`}
        </Code>
        <p className="mt-3 text-sm text-quiet">
          Source:{" "}
          <a
            href="https://github.com/thenewforktimes/contentRX/tree/main/mcp-server"
            className="underline underline-offset-2"
          >
            mcp-server
          </a>
          .
        </p>
      </Section>

      <Section
        id="action"
        title="GitHub Action. PR gate"
        pill={<Pill tone="neutral">Coming soon</Pill>}
      >
        <p>
          Drop a YAML into{" "}
          <code>.github/workflows/</code>. ContentRX evaluates the
          checks touched in every pull request.
        </p>
        <p className="mt-3 text-sm text-quiet">
          Marketplace listing coming soon. The snippet below is the
          shape it&apos;ll land with.
        </p>
        <Code>
          {`# .github/workflows/contentrx.yml
name: ContentRX
on: pull_request
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: thenewforktimes/contentrx-action@v1
        with:
          api-key: \${{ secrets.CONTENTRX_API_KEY }}
          fail-on: violation  # or review`}
        </Code>
        <p className="mt-3 text-sm text-quiet">
          Source:{" "}
          <a
            href="https://github.com/thenewforktimes/contentRX/tree/main/github-action"
            className="underline underline-offset-2"
          >
            github-action
          </a>
          .
        </p>
      </Section>

      <Section id="cli" title="CLI. contentrx on PyPI">
        <p>
          One pip install. Stdlib-only runtime. Exit codes are part
          of the public API, gate pipelines on them.
        </p>
        <Code>
          {`pip install contentrx-cli
export CONTENTRX_API_KEY=cx_...
contentrx "Click here"
contentrx --batch strings.txt --json
contentrx --explain "Are you sure?"`}
        </Code>
        <p className="mt-3 text-sm text-quiet">
          Source:{" "}
          <a
            href="https://github.com/thenewforktimes/contentRX/tree/main/cli-client"
            className="underline underline-offset-2"
          >
            cli-client
          </a>
          .
        </p>
      </Section>

      <Section id="lsp" title="LSP server. Inline diagnostics in any LSP editor">
        <p>
          Diagnostics as you type. Right-click to rewrite in place,
          open the rationale, or mark false positive.
        </p>
        <p className="mt-3">Any LSP editor (VS Code, Cursor, Zed, Neovim, JetBrains, emacs lsp-mode):</p>
        <Code>
          {`uvx contentrx-lsp                    # one-shot, no persistent install
# or:
pipx install contentrx-lsp           # persistent install
# or:
uv tool install contentrx-lsp        # persistent install via uv

export CONTENTRX_API_KEY=cx_...
# Point your editor's LSP client at \`contentrx-lsp\` (stdio)`}
        </Code>
        <p className="mt-3 text-sm text-quiet">
          A VS Code extension that wraps the LSP is in development.
          Marketplace listing coming soon. The manual install above
          works in VS Code today via any generic LSP-client extension.
        </p>
        <p className="mt-3 text-sm text-quiet">
          Scope is JSX and TSX text children, plus the{" "}
          <code>alt</code>, <code>aria-label</code>,{" "}
          <code>placeholder</code>, <code>title</code>,{" "}
          <code>tooltip</code>, and <code>label</code> attributes.
          Random source-code literals stay unflagged. Source:{" "}
          <a
            href="https://github.com/thenewforktimes/contentRX/tree/main/lsp-server"
            className="underline underline-offset-2"
          >
            lsp-server
          </a>
          .
        </p>
      </Section>

      <Section
        id="figma"
        title="Figma plugin. Design-time check, alongside the engine"
        pill={<Pill tone="neutral">Coming soon</Pill>}
      >
        <p>
          Catch checks at design time, before they land in code.
          Per-check verdicts and a stance on every finding.
        </p>
        <p className="mt-3 text-sm text-quiet">
          Figma Community publication is in review. We&apos;ll
          announce on{" "}
          <Link href="/accuracy" className="underline underline-offset-2">
            /accuracy
          </Link>
          {" "}when the plugin lands and email everyone on the
          waitlist.
        </p>
      </Section>

      <p className="mt-12 text-sm text-quiet">
        Mint an API key on{" "}
        <Link href="/dashboard" className="underline underline-offset-2">
          /dashboard
        </Link>
        . See{" "}
        <Link href="/accuracy" className="underline underline-offset-2">
          /accuracy
        </Link>
        {" "}for the calibration numbers.
      </p>
    </main>
  );
}

function SurfaceChip({
  href,
  label,
  tagline,
}: {
  href: string;
  label: string;
  tagline: string;
}) {
  return (
    <a
      href={href}
      className="flex items-baseline gap-2 rounded-md border border-line-strong px-3 py-1.5 text-xs hover:bg-hover"
    >
      <span className="font-mono font-semibold">{label}</span>
      <span className="text-quiet">{tagline}</span>
    </a>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-md border border-line bg-sunken p-3 text-xs">
      <code className="font-mono text-default">
        {children}
      </code>
    </pre>
  );
}
