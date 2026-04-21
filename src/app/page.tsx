import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-24">
      <div>
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">
          ContentRX
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
          The content-design linter for Figma and code.
        </h1>
        <p className="mt-6 text-lg text-neutral-600 dark:text-neutral-400">
          Moment-aware evaluation. Rule-cited violations. Runs where you write:
          Figma, your CLI, and every pull request.
        </p>
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        <a
          href="#"
          className="rounded-md bg-black px-4 py-2 text-white hover:opacity-90 dark:bg-white dark:text-black"
        >
          Install for Figma
        </a>
        <Link
          href="/sign-in"
          className="rounded-md border border-neutral-300 px-4 py-2 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Sign in
        </Link>
      </div>
      <p className="text-xs text-neutral-500">
        Placeholder landing. Real marketing copy ships in Session 5.
      </p>
    </main>
  );
}
