/**
 * /sources — public attribution surface.
 *
 * Human-eval build plan Session 19. Session 14 shipped a stub; this
 * session populates the page from the committed attribution metadata.
 *
 * Everything here generates at build time from:
 *
 *   - `src/content_checker/standards/standards_library.json`
 *     per-standard `sources` arrays (30/47 standards).
 *   - `src/content_checker/moments.py` docstring citations (12 style
 *     guides that inform moment-weight philosophy).
 *   - `evals/examples_corpus/pairs.json` — 38 before/after pairs.
 *   - `external_signal/allow_list.json` — 20 OSS repos on the
 *     content-mining allow-list.
 *
 * No hand-maintained lists. Aggregation lives in
 * `src/lib/sources-data.ts`; the page is a thin renderer.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Pill } from "@/components/ui/pill";
import {
  loadSourcesData,
  type OSSRepoSource,
  type Role,
  type StyleGuideSource,
} from "@/lib/sources-data";

export const metadata: Metadata = {
  title: "Sources. ContentRX",
  description:
    "Every design system, style guide, and OSS repo ContentRX has ingested, with roles, license, and opt-out paths.",
};

const ROLE_LABELS: Record<Role, string> = {
  standard_influences: "Standard influences",
  examples_corpus: "Examples corpus",
  moment_weights: "Context weights",
  training_signal: "Training signal",
};

function optOutMailto(name: string): string {
  const subject = `[OPTOUT] ${name}`;
  return `mailto:hello@contentrx.io?subject=${encodeURIComponent(subject)}`;
}

export default function SourcesPage() {
  const data = loadSourcesData();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="mb-12">
        <p className="text-xs font-semibold uppercase tracking-widest text-quiet">
          Attribution surface
        </p>
        <h1 className="mt-3 text-3xl font-semibold">Sources</h1>
        <p className="mt-4 text-sm text-quiet">
          Every public source that informs ContentRX (design systems,
          style guides, OSS repositories) listed with its role, license,
          and opt-out path. This page is the accountability surface for{" "}
          <Link href="/ethics" className="underline underline-offset-2">
            /ethics
          </Link>
          &apos;s transparency commitment.
        </p>
        <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
          <Stat
            label="Style guides"
            value={data.style_guides.length.toString()}
          />
          <Stat
            label="Example pairs"
            value={data.pairs_total.toString()}
          />
        </dl>
      </header>

      <section className="mt-12">
        <h2 className="text-xl font-semibold">
          Design systems and style guides
        </h2>
        <p className="mt-2 text-sm text-quiet">
          Each system below informs the ContentRX content model. Role
          badges show how: <em>standard influences</em> means the system
          is cited on one or more standards;{" "}
          <em>examples corpus</em> means before/after pairs live in the
          committed examples corpus; <em>context weights</em> means the
          system informs how context emphasizes, relaxes, or suppresses
          standards.
        </p>
        <ul className="mt-6 space-y-6">
          {data.style_guides.map((s) => (
            <StyleGuideCard key={s.name} source={s} />
          ))}
        </ul>
      </section>

      <section className="mt-16">
        <h2 className="text-xl font-semibold">Open-source repositories</h2>
        <p className="mt-2 text-sm text-quiet">
          {data.oss_repos.length} public repositories on the ContentRX
          content-mining allow-list. The miner extracts before/after
          pairs from commit history. See{" "}
          <a
            href="https://github.com/thenewforktimes/contentRX/blob/main/external_signal/README.md"
            className="underline underline-offset-2"
          >
            external_signal
          </a>{" "}
          for pipeline details. Each repo&apos;s quality signals indicate
          the presence of a content designer, active i18n, or a content-
          design blog: proxies for the care taken with content.
        </p>
        <ul className="mt-6 space-y-6">
          {data.oss_repos.map((r) => (
            <OSSRepoCard key={`${r.owner}/${r.name}`} repo={r} />
          ))}
        </ul>
      </section>

      <section className="mt-12 rounded-md border border-line bg-raised p-4 text-sm">
        <p className="text-default">
          The other half of ContentRX&apos;s accountability surface is{" "}
          <Link href="/accuracy" className="underline underline-offset-2">
            /accuracy
          </Link>
          : measured system κ with 95% CI, measured self-drift κ, and
          the design target stated separately. No composite score.
        </p>
      </section>

      <section className="mt-6 rounded-lg border border-line-strong bg-overlay p-6 text-sm">
        <h2 className="text-base font-semibold">How to opt out</h2>
        <p className="mt-2 text-default">
          If you maintain one of the sources above and don&apos;t want
          ContentRX to continue using it, email{" "}
          <a
            href="mailto:hello@contentrx.io?subject=%5BOPTOUT%5D+%3Csource+name%3E"
            className="underline underline-offset-2"
          >
            hello@contentrx.io
          </a>{" "}
          with subject line{" "}
          <code className="rounded bg-raised px-1 py-0.5 font-mono text-xs">
            [OPTOUT] &lt;source name&gt;
          </code>
          . Each card above has a prefilled opt-out link. See{" "}
          <Link href="/ethics" className="underline underline-offset-2">
            /ethics
          </Link>{" "}
          for the full commitment.
        </p>
      </section>

      <footer className="mt-16 text-xs text-quiet">
        <p>
          Generated {formatDate(data.generated_at)} from committed
          attribution metadata. Source:{" "}
          <a
            href="https://github.com/thenewforktimes/contentRX/blob/main/src/lib/sources-data.ts"
            className="underline underline-offset-2"
          >
            sources-data.ts
          </a>
          .
        </p>
      </footer>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-overlay px-4 py-3">
      <dt className="text-xs uppercase tracking-wide text-quiet">
        {label}
      </dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function StyleGuideCard({ source }: { source: StyleGuideSource }) {
  return (
    <li className="rounded-md border border-line p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-base font-semibold">
          <a
            href={source.homepage_url}
            className="underline underline-offset-2"
            rel="external noreferrer"
          >
            {source.name}
          </a>
        </h3>
        <span className="rounded bg-raised px-2 py-0.5 font-mono text-xs text-default">
          {source.license}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {source.roles.map((r) => (
          <RoleBadge key={r} role={r} />
        ))}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-default">
        <div>
          <dt className="text-xs uppercase tracking-wide text-quiet">
            Standards influenced
          </dt>
          <dd className="mt-0.5 tabular-nums">
            {source.standards_count.toString()}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-quiet">
            Example pairs
          </dt>
          <dd className="mt-0.5 tabular-nums">
            {source.examples_count}
          </dd>
        </div>
      </dl>

      <p className="mt-4 text-xs text-quiet">
        <a
          href={optOutMailto(source.name)}
          className="underline underline-offset-2"
        >
          Opt out of future inclusion
        </a>
      </p>
    </li>
  );
}

function OSSRepoCard({ repo }: { repo: OSSRepoSource }) {
  const repoUrl = `https://github.com/${repo.owner}/${repo.name}`;
  const signals: string[] = [];
  if (repo.quality_signals.has_content_designer) signals.push("content designer");
  if (repo.quality_signals.active_i18n) signals.push("active i18n");
  if (repo.quality_signals.content_design_blog) signals.push("content-design blog");

  return (
    <li className="rounded-md border border-line p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-base font-semibold">
          <a
            href={repoUrl}
            className="font-mono underline underline-offset-2"
            rel="external noreferrer"
          >
            {repo.owner}/{repo.name}
          </a>
        </h3>
        <span className="rounded bg-raised px-2 py-0.5 font-mono text-xs text-default">
          {repo.license}
        </span>
      </div>

      <p className="mt-3 text-sm text-default">
        {repo.reason}
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-default">
        <div>
          <dt className="text-xs uppercase tracking-wide text-quiet">
            Quality signals
          </dt>
          <dd className="mt-0.5 text-xs">
            {signals.length === 0 ? "None" : signals.join(" • ")}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-quiet">
            Last crawl
          </dt>
          <dd className="mt-0.5 text-xs tabular-nums">
            {repo.last_crawl_at
              ? formatDate(repo.last_crawl_at)
              : "Not yet crawled"}
          </dd>
        </div>
      </dl>

      <p className="mt-4 text-xs text-quiet">
        <a
          href={optOutMailto(`${repo.owner}/${repo.name}`)}
          className="underline underline-offset-2"
        >
          Opt out of future crawls
        </a>
      </p>
    </li>
  );
}

function RoleBadge({ role }: { role: Role }) {
  return <Pill tone="neutral">{ROLE_LABELS[role]}</Pill>;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}
