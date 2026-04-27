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
 * Voice note for Robo: the prose is in my voice; the install
 * snippets are pinned against the real package metadata and should
 * stay in sync with cli-client + mcp-server version bumps. Snippet
 * correctness is the most important thing on this page — test
 * against the real published commands before editing prose.
 */

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Install — ContentRX",
  description:
    "Install ContentRX for Claude Code, Cursor, any LSP editor, your CLI, GitHub Actions, or Figma. Generation-layer surfaces lead; the Figma plugin sits alongside for design-time checks.",
};

export default function InstallPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <header className="mb-12">
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">
          Install
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Five surfaces, one content model.
        </h1>
        <p className="mt-4 text-lg text-neutral-700 dark:text-neutral-300">
          Content-standards enforcement is moving upstream into the
          generation layer. Install ContentRX where your team actually
          writes product copy — in the IDE, on the command line, in
          pull requests — with the Figma plugin alongside for the
          strings that arrive through design.
        </p>
        <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
          All five surfaces hit the same public API. One{" "}
          <Link href="/dashboard" className="underline underline-offset-2">
            API key
          </Link>
          {" "}covers them all. Pick the ones your team lives in.
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
        title="MCP server — Claude Code, Cursor, any MCP client"
        body={
          <>
            <p>
              The ContentRX MCP server exposes four tools to any MCP
              client: <code>evaluate_copy</code>,{" "}
              <code>classify_moment</code>, <code>explain_violation</code>,
              and <code>list_standards</code>. Claude Code or Cursor
              can check a string inline during generation — the LLM
              narrates the moment first, then the verdict, then the
              rationale chain on demand.
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
            <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
              Source + full tool surface:{" "}
              <a
                href="https://github.com/thenewforktimes/contentRX/tree/main/mcp-server"
                className="underline underline-offset-2"
              >
                mcp-server
              </a>
              .
            </p>
          </>
        }
      />

      <Section
        id="lsp"
        eyebrow="Surface 2"
        title="LSP server — inline diagnostics in any LSP editor"
        body={
          <>
            <p>
              Diagnostics appear as you type, the same way TypeScript
              errors do. Yellow squiggles for violations; blue
              squiggles for review-recommended strings. Right-click a
              diagnostic to rewrite in place (Claude via{" "}
              <code>/api/suggest-fix</code>), open the standard&apos;s
              rationale page, or mark as false positive.
            </p>
            <p className="mt-3">
              VS Code / Cursor (one-click — the extension launches
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
            <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
              Scope: JSX / TSX text children + copy attributes
              (<code>alt</code>, <code>aria-label</code>,{" "}
              <code>placeholder</code>, <code>title</code>,{" "}
              <code>tooltip</code>, <code>label</code>). Random string
              literals aren&apos;t extracted — false-positive risk is
              too high. Source:{" "}
              <a
                href="https://github.com/thenewforktimes/contentRX/tree/main/lsp-server"
                className="underline underline-offset-2"
              >
                lsp-server
              </a>
              .
            </p>
          </>
        }
      />

      <Section
        id="cli"
        eyebrow="Surface 3"
        title="CLI — contentrx on PyPI"
        body={
          <>
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
            <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
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
          </>
        }
      />

      <Section
        id="action"
        eyebrow="Surface 4"
        title="GitHub Action — PR gate"
        body={
          <>
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
            <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
              Action source + the full input surface:{" "}
              <a
                href="https://github.com/thenewforktimes/contentRX/tree/main/github-action"
                className="underline underline-offset-2"
              >
                github-action
              </a>
              .
            </p>
          </>
        }
      />

      <Section
        id="figma"
        eyebrow="Surface 5 · alongside"
        title="Figma plugin — design-time check"
        body={
          <>
            <p>
              The Figma plugin catches strings that arrive through
              design — badges, empty states, onboarding flows — before
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
                className="inline-block rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
              >
                Figma Community →
              </a>
            </p>
            <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
              Sign in once via the dashboard to mint an API key;
              paste it into the plugin&apos;s sign-in panel.
            </p>
          </>
        }
      />

      <section className="mt-16 border-t border-neutral-200 pt-10 dark:border-neutral-800">
        <h2 className="text-xl font-semibold">
          Stacking surfaces
        </h2>
        <p className="mt-3 text-sm text-neutral-700 dark:text-neutral-300">
          The surfaces stack cleanly. A team typically runs the MCP
          server locally for inline checks during authoring, the
          GitHub Action as the PR gate, and the Figma plugin for the
          designer-led flows. The CLI covers batch jobs and one-off
          checks from any terminal. All four share one model, one
          quota, one set of team rules.
        </p>
        <p className="mt-3 text-sm text-neutral-700 dark:text-neutral-300">
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
      </section>
    </main>
  );
}

function Section({
  id,
  eyebrow,
  title,
  body,
}: {
  id: string;
  eyebrow: string;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="mt-12 scroll-mt-16 border-t border-neutral-200 pt-10 first:border-t-0 first:pt-0 dark:border-neutral-800"
    >
      <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">
        {eyebrow}
      </p>
      <h2 className="mt-2 text-2xl font-semibold">{title}</h2>
      <div className="mt-4 text-base text-neutral-700 dark:text-neutral-300">
        {body}
      </div>
    </section>
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
      className="flex items-baseline gap-2 rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
    >
      <span className="font-mono font-semibold">{label}</span>
      <span className="text-neutral-500">{tagline}</span>
    </a>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs dark:border-neutral-800 dark:bg-neutral-950">
      <code className="font-mono text-neutral-800 dark:text-neutral-200">
        {children}
      </code>
    </pre>
  );
}
