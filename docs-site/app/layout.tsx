import type { Metadata } from "next";
import { Sidebar } from "@/components/sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "ContentRX docs — content model spec",
  description:
    "The 47 content standards, 13 moments, and 8 content types behind the ContentRX evaluator.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="bg-white text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        <div className="flex">
          <Sidebar />
          <main className="min-w-0 flex-1">
            <article className="prose prose-neutral mx-auto max-w-3xl px-6 py-12 dark:prose-invert">
              {children}
            </article>
          </main>
        </div>
      </body>
    </html>
  );
}
