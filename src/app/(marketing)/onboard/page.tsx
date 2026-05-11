/**
 * /onboard — the surface picker (PR-18).
 *
 * Default post-signup destination via Clerk's `fallbackRedirectUrl`
 * on the SignUp component. The customer-journey diagrams put this
 * right after Clerk auth: "Where do you want to use ContentRX?"
 * Five options — one per generation-layer surface (MCP, LSP, Action,
 * Figma, CLI). The Audit Pack option was removed alongside the SKU
 * itself; if we re-add a one-time pricing tier later, this picker
 * can grow back to six.
 *
 * Picking a surface routes to its anchor on /install. All picks are
 * stateless for now — we don't persist the choice yet (PR-24's
 * welcome email branching can read it from the redirect params if
 * we want to thread state through later).
 *
 * The page is reachable any time post-signup; users can revisit it
 * by URL. Not gated by "first-time only" for v1 — keeping it
 * simple per the design direction.
 */

import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ButtonArrow } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";

export const metadata = {
  title: "Welcome to ContentRX. Pick a surface",
};

type SurfaceOption = {
  key: string;
  name: string;
  description: string;
  href: string;
  cta: string;
};

const SURFACE_OPTIONS: ReadonlyArray<SurfaceOption> = [
  {
    key: "mcp",
    name: "MCP server",
    description:
      "Inline checks in Claude Code, Cursor, or any MCP client. The LLM narrates the verdict before you ship.",
    href: "/install#mcp",
    cta: "Set up MCP",
  },
  {
    key: "lsp",
    name: "LSP server",
    description:
      "Diagnostics in VS Code, Zed, JetBrains, Neovim, anywhere with an LSP client. Squiggle as you type.",
    href: "/install#lsp",
    cta: "Set up LSP",
  },
  {
    key: "action",
    name: "GitHub Action",
    description:
      "Gate every PR on content quality. Drop a YAML snippet into .github/workflows/.",
    href: "/install#action",
    cta: "Set up the GitHub Action",
  },
  {
    key: "figma",
    name: "Figma plugin",
    description:
      "Catch strings during design, before they land in code. Per-frame verdicts in the side panel.",
    href: "/install#figma",
    cta: "Set up the Figma plugin",
  },
  {
    key: "cli",
    name: "CLI",
    description:
      "Batch checks from the terminal or CI. One pip install, stdlib runtime, exit codes you can pipe.",
    href: "/install#cli",
    cta: "Set up CLI",
  },
];

export default async function OnboardPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-up?redirect_url=/onboard");
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <header className="mb-10">
        <Eyebrow>Welcome to ContentRX</Eyebrow>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
          Where do you want to use it first?
        </h1>
        <p className="mt-4 text-lg text-default">
          Pick the surface you&apos;ll start with. You can use the others
          later. One API key covers them all, and your 10 free checks
          a month are shared across every surface.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SURFACE_OPTIONS.map((option) => (
          <Link
            key={option.key}
            href={option.href}
            className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg"
          >
            <Card
              padding="lg"
              className="flex h-full flex-col gap-3 transition group-hover:border-line-strong"
            >
              <h2 className="text-base font-semibold">{option.name}</h2>
              <p className="flex-1 text-sm text-default">
                {option.description}
              </p>
              <p className="text-sm font-medium text-strong">
                {option.cta} <ButtonArrow />
              </p>
            </Card>
          </Link>
        ))}
      </section>

      <footer className="mt-12 text-sm text-quiet">
        <p>
          Not sure?{" "}
          <Link
            href="/dashboard"
            className="underline underline-offset-2"
          >
            Skip and go to your dashboard
          </Link>
          . You can pick a surface any time from{" "}
          <Link href="/install" className="underline underline-offset-2">
            /install
          </Link>
          .
        </p>
      </footer>
    </main>
  );
}
