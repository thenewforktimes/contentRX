/**
 * Route-segment loading skeleton for `/admin/*`.
 *
 * Shows during the cold render while admin loaders settle (DB
 * queries, file reads for calibration / refinement-log / costs). The
 * skeleton matches the common admin page shape — eyebrow + title +
 * body text + a few card-shaped sections — so the layout doesn't
 * jump when content arrives.
 *
 * Mirrors `(authed)/dashboard/loading.tsx`: plain Tailwind, no
 * client JS. `role="status" aria-busy="true"` + `sr-only`
 * announcement so screen-reader users are told the page is loading
 * instead of hearing nothing until data lands (WCAG 4.1.3).
 *
 * Renders inside the admin layout's `<main id="main-content">`, so
 * no nested `<main>` here.
 */

import { Eyebrow } from "@/components/ui/eyebrow";

const skeletonClass =
  "animate-pulse rounded-lg border border-line bg-sunken/40";

export default function AdminLoading() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">Loading admin page.</span>
      <header className="flex flex-col gap-2">
        <Eyebrow>Admin</Eyebrow>
        <div className="h-7 w-56 animate-pulse rounded bg-sunken" />
        <div className="mt-1 h-4 w-2/3 animate-pulse rounded bg-sunken/60" />
      </header>
      <section className={`${skeletonClass} h-32 p-5`} />
      <section className={`${skeletonClass} h-48 p-5`} />
      <section className={`${skeletonClass} h-32 p-5`} />
    </div>
  );
}
