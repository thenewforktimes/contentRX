/**
 * `/admin/essay-drafts/[filename]` — single-draft preview.
 *
 * Phase B7b of the post-pivot rolling plan. Read-only view of a saved
 * draft from `essays/drafts/<filename>.md`. Edits happen on the
 * primary `/admin/essay-drafts` page (textarea + save) and on disk
 * via the founder's editor; this page is for spot-checking what's
 * been saved without leaving the dashboard.
 *
 * Auth handled by `src/app/admin/layout.tsx`.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { loadDraft } from "@/lib/admin-essay-drafts.server";

export const metadata = {
  title: "Essay draft · ContentRX admin",
  robots: { index: false, follow: false },
};

export default async function AdminEssayDraftPreviewPage({
  params,
}: {
  params: Promise<{ filename: string }>;
}) {
  const { filename: filenameRaw } = await params;
  const filename = decodeURIComponent(filenameRaw);
  const draft = loadDraft(filename);
  if (!draft) notFound();

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs">
          <Link
            href="/admin/essay-drafts"
            className="text-neutral-600 hover:underline dark:text-neutral-400"
          >
            ← Back to essay drafts
          </Link>
        </p>
        <h1 className="mt-2 font-mono text-xl text-neutral-900 dark:text-neutral-100">
          {draft.filename}
        </h1>
        <dl className="mt-3 flex flex-wrap gap-4 text-xs text-neutral-600 dark:text-neutral-400">
          <div>
            <dt className="font-semibold uppercase tracking-wide text-neutral-500">
              Path
            </dt>
            <dd className="font-mono">essays/drafts/{draft.filename}</dd>
          </div>
          <div>
            <dt className="font-semibold uppercase tracking-wide text-neutral-500">
              Modified
            </dt>
            <dd className="font-mono">
              {draft.modified_at.replace("T", " ").slice(0, 16)}
            </dd>
          </div>
          <div>
            <dt className="font-semibold uppercase tracking-wide text-neutral-500">
              Size
            </dt>
            <dd className="font-mono">
              {draft.size_bytes.toLocaleString()} bytes
            </dd>
          </div>
        </dl>
      </header>

      <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="border-b border-neutral-200 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
          Raw contents
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap break-words p-4 font-sans text-sm leading-relaxed text-neutral-800 dark:text-neutral-200">
{draft.contents}
        </pre>
      </div>

      <p className="text-xs text-neutral-500">
        Edits live on the primary{" "}
        <Link
          href="/admin/essay-drafts"
          className="text-neutral-700 underline hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
        >
          /admin/essay-drafts
        </Link>{" "}
        page (current week&apos;s draft) or in the founder&apos;s editor against{" "}
        <code className="font-mono">essays/drafts/{draft.filename}</code>.
      </p>
    </div>
  );
}
