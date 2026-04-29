import Link from "next/link";
import { SignOutButton } from "@clerk/nextjs";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white dark:bg-stone-950">
      <header className="border-b border-stone-200 dark:border-stone-800">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="text-sm font-semibold">
            ContentRX
          </Link>
          <SignOutButton>
            <button
              type="button"
              className="text-xs text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
            >
              Sign out
            </button>
          </SignOutButton>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">{children}</main>
    </div>
  );
}
