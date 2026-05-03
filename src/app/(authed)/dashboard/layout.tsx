import Link from "next/link";
import { SignOutButton } from "@clerk/nextjs";
import { SiteFooter } from "@/components/site-footer";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-stone-950">
      <header className="border-b border-stone-200 dark:border-stone-800">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-6 px-6 py-4">
          <Link href="/dashboard" className="text-sm font-semibold">
            ContentRX
          </Link>
          <nav className="flex items-center gap-5 text-xs">
            <Link
              href="/dashboard"
              className="text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100"
            >
              Dashboard
            </Link>
            <Link
              href="/dashboard/settings"
              className="text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100"
            >
              Settings
            </Link>
            <SignOutButton>
              <button
                type="button"
                className="text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100"
              >
                Sign out
              </button>
            </SignOutButton>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
