/**
 * /install — per-surface install instructions.
 *
 * Human-eval build plan Session 29. Lead with generation-layer
 * surfaces: MCP server, CLI, GitHub Action. Figma plugin sits at the
 * bottom, reframed as the design-time checker rather than the
 * flagship.
 *
 * Each section has an anchor (#mcp, #cli, #action, #figma) so the
 * landing page's per-surface "Install" links deep-link here.
 *
 * Voice note for Robert: the prose is in my voice; the install
 * snippets are pinned against the real package metadata and should
 * stay in sync with cli-client + mcp-server version bumps. Snippet
 * correctness is the most important thing on this page — test
 * against the real published commands before editing prose.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Section } from "@/components/ui/section";

export const metadata: Metadata = {
  title: "Install. ContentRX",
  description:
    "Install ContentRX for Claude Code, Cursor, any LSP editor, your CLI, GitHub Actions, or Figma. Generation-layer surfaces lead; the Figma plugin sits alongside for design-time checks.",
};

export default function InstallPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <header className="mb-12">
        <Eyebrow>Install</Eyebrow>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Five surfaces, one content model.
        </h1>
        <p className="mt-4 text-lg text-stone-700 dark:text-stone-300">
          Content-standards enforcement is moving upstream into the
          generation layer. Install ContentRX where your team actually
          writes product copy (in the IDE, on the command line, in
          pull requests) with the Figma plugin alongside for the
          strings that arrive through design.
        </p>
        <p className="mt-4 text-sm text-stone-600 dark:text-stone-400">
          All five surfaces hit the same public API. One{" "}
          <Link href="/dashboard" className="underline underline-offset-2">
            API key
          </Link>
          {" "}covers them all. ContentRX handles the LLM relationship,
          which means your text travels through one vendor relationship
          (us to Anthropic), not two. You don&apos;t need an Anthropic
          or OpenAI key. Pick the surfaces your team lives in.
        </p>
        <nav className="mt-6 flex flex-wrap gap-2 text-sm">
          <SurfaceChip href="#mcp" label="MCP" tagline="Claude Code · Cursor" />
          <SurfaceChip href="#lsp" label="LSP" tagline="VS Code · Cursor · Zed" />
          <SurfaceChip href="#cli" label="CLI" tagline="contentrx" />
          <SurfaceChip href="#action" label="GitHub Action" tagline="PR gate" />
          <SurfaceChip href="#figma" label="Figma plugin" tagline="design-time" />
        </nav>
      </header>

      <Section
        id="mcp"
        eyebrow="Surface 1"
        title="MCP server. Claude Code, Cursor, any MCP client"
      >
        <p>
          The ContentRX MCP server exposes <code>evaluate_copy</code>{" "}
          and <code>classify_moment</code> tools (plus team
          custom-example management) to any MCP client. Claude Code
          or Cursor can check a string inline during generation. The
          LLM narrates the moment first, then the verdict, then a
          suggested rewrite.
        </p>
        <p className="mt-3">
          Claude Code:
        </p>
        <Code>{`claude mcp add contentrx -- uvx contentrx-mcp`}</Code>
        <p className="mt-3">
          Any MCP client (stdio):
        </p>
        <Code>
          {`export CONTENTRX_API_KEY=cx_...
uvx contentrx-mcp`}
        </Code>
        <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">
          Source + full tool surface:{" "}
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
        id="lsp"
        eyebrow="Surface 2"
        title="LSP server. Inline diagnostics in any LSP editor"
      >
        <p>
          Diagnostics appear as you type, the same way TypeScript
          errors do. Yellow squiggles for violations; blue
          squiggles for review-recommended strings. Right-click a
          diagnostic to rewrite in place (Claude via{" "}
          <code>/api/suggest-fix</code>), open the standard&apos;s
          rationale page, or mark as false positive.
        </p>
        <p className="mt-3">
          VS Code / Cursor (one-click, the extension launches
          the server for you):
        </p>
        <Code>
          {`# Install the ContentRX extension from the Marketplace
# Then: command palette → "ContentRX: Set API key"`}
        </Code>
        <p className="mt-3">
          Any LSP editor (Zed, Neovim, JetBrains, emacs lsp-mode):
        </p>
        <Code>
          {`uv tool install contentrx-lsp        # or: pipx install contentrx-lsp
export CONTENTRX_API_KEY=cx_...
# Point your editor's LSP client at \`contentrx-lsp\` (stdio)`}
        </Code>
        <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">
          Scope: JSX / TSX text children + copy attributes
          (<code>alt</code>, <code>aria-label</code>,{" "}
          <code>placeholder</code>, <code>title</code>,{" "}
          <code>tooltip</code>, <code>label</code>). Random string
          literals aren&apos;t extracted: false-positive risk is
          too high. Source:{" "}
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
        id="cli"
        eyebrow="Surface 3"
        title="CLI. contentrx on PyPI"
      >
        <p>
          Stdlib-only runtime (no <code>requests</code>, no{" "}
          <code>httpx</code>). One <code>pip install</code> and
          you&apos;re checking strings from any terminal or CI
          runner. Exit codes are part of the public API so
          pipelines can gate on them.
        </p>
        <Code>
          {`pip install contentrx-cli
export CONTENTRX_API_KEY=cx_...
contentrx "Click here"
contentrx --batch strings.txt --json
contentrx --explain "Are you sure?"`}
        </Code>
        <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">
          <code>--explain</code> prints the full rationale chain
          after the verdict. <code>--json</code> emits the raw API
          response for scripting. Full flag list:{" "}
          <a
            href="https://github.com/thenewforktimes/contentRX/tree/main/cli-client"
            className="underline underline-offset-2"
          >
            cli-client
          </a>
          .
        </p>
      </Section>

      <Section
        id="action"
        eyebrow="Surface 4"
        title="GitHub Action. PR gate"
      >
        <p>
          Drop a YAML snippet into{" "}
          <code>.github/workflows/</code> and ContentRX evaluates
          strings touched in every pull request. Use{" "}
          <code>fail-on: review</code> to block merges on
          review-recommended verdicts, or stay permissive with the
          default <code>fail-on: violation</code>.
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
        <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">
          Action source + the full input surface:{" "}
          <a
            href="https://github.com/thenewforktimes/contentRX/tree/main/github-action"
            className="underline underline-offset-2"
          >
            github-action
          </a>
          .
        </p>
      </Section>

      <Section
        id="figma"
        eyebrow="Surface 5 · alongside"
        title="Figma plugin. Design-time check"
      >
        <p>
          The Figma plugin catches strings that arrive through
          design (badges, empty states, onboarding flows) before
          they land in code. Per-string verdicts, moment banners,
          three-button stance on every finding (Agree / Disagree /
          Ship anyway), and the rationale chain on demand.
        </p>
        <p className="mt-3">
          Install from Figma Community:
        </p>
        <p className="mt-2">
          <a
            href="https://www.figma.com/community/plugin/"
            className={buttonStyles({ variant: "secondary" })}
          >
            Figma Community →
          </a>
        </p>
        <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">
          Sign in once via the dashboard to mint an API key;
          paste it into the plugin&apos;s sign-in panel.
        </p>
      </Section>

      <Section title="Stacking surfaces">
        <p className="text-sm">
          The surfaces stack cleanly. A team typically runs the MCP
          server locally for inline checks during authoring, the LSP
          for as-you-type diagnostics, the GitHub Action as the PR
          gate, and the Figma plugin for the designer-led flows. The
          CLI covers batch jobs and one-off checks from any terminal.
          All five share one model, one monthly limit, one set of
          team rules.
        </p>
        <p className="mt-3 text-sm">
          See{" "}
          <Link href="/accuracy" className="underline underline-offset-2">
            /accuracy
          </Link>
          {" "}for the calibration numbers and{" "}
          <Link href="/dashboard" className="underline underline-offset-2">
            /dashboard
          </Link>
          {" "}to mint an API key.
        </p>
      </Section>
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
      className="flex items-baseline gap-2 rounded-md border border-stone-300 px-3 py-1.5 text-xs hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-900"
    >
      <span className="font-mono font-semibold">{label}</span>
      <span className="text-stone-500 dark:text-stone-400">{tagline}</span>
    </a>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-md border border-stone-200 bg-stone-50 p-3 text-xs dark:border-stone-800 dark:bg-stone-950">
      <code className="font-mono text-stone-800 dark:text-stone-200">
        {children}
      </code>
    </pre>
  );
}
