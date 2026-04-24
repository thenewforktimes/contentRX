/**
 * /case-studies — OSS case-study index.
 *
 * Human-eval build plan Sessions 26–28. Lists every published case
 * study plus a curated candidate shortlist for transparency. At
 * scaffolding time the published list is empty — the page surfaces
 * that honestly rather than faking it.
 *
 * The candidate shortlist comes from `tools/case_study_candidates.py`
 * which scores `external_signal/allow_list.json` entries by the
 * count of quality signals (content_designer / active_i18n /
 * content_design_blog) and the permissiveness of the license. The
 * committed output at `evals/case_study_candidates.json` feeds this
 * page.
 */

import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { CASE_STUDIES } from "@/lib/case-studies";

export const metadata = {
  title: "Case studies · ContentRX docs",
  description:
    "OSS projects ContentRX has run against, with maintainer approval and per-finding judgment-call critique.",
};

type Candidate = {
  owner: string;
  name: string;
  license: string;
  reason: string;
  score: number;
  quality_signals: {
    has_content_designer: boolean;
    active_i18n: boolean;
    content_design_blog: boolean;
  };
};

type CandidatesFile = {
  generated_at: string;
  top: Candidate[];
};

function loadCandidates(): CandidatesFile | null {
  const p = path.join(
    process.cwd(),
    "..",
    "evals",
    "case_study_candidates.json",
  );
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf-8")) as CandidatesFile;
  } catch {
    return null;
  }
}

export default function CaseStudiesIndex() {
  const candidates = loadCandidates();

  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
        Case studies
      </p>
      <h1>ContentRX, applied to real OSS projects</h1>
      <p className="text-lg">
        Each case study is a real run of ContentRX against a public
        project&apos;s UI copy, with the maintainers&apos; written
        approval, focused on the judgment calls a generic linter would
        miss — error messages that blame the user, permissions
        buttons that should be specific verbs, empty states that
        aren&apos;t encouraging.
      </p>
      <p>
        This page stays honest about its state. When no study has
        shipped yet, it says so. When studies ship, they land here
        with per-finding critique and links to any resulting PRs on
        the project&apos;s repo.
      </p>

      <section>
        <h2>Published case studies</h2>
        {CASE_STUDIES.length === 0 ? (
          <p>
            <em>
              None yet. The scaffolding for case studies
              (sessions 26–28) shipped first; the three published
              studies land as maintainer approval lands. See the
              shortlist below for the projects under consideration.
            </em>
          </p>
        ) : (
          <ul>
            {CASE_STUDIES.map((s) => (
              <li key={s.slug}>
                <Link href={`/case-studies/${s.slug}`}>
                  <strong>{s.project_name}</strong>
                </Link>
                {" — "}
                {s.teaser}
                <br />
                <span className="text-xs text-neutral-500">
                  {s.judgment_calls.length} judgment calls · approved by{" "}
                  <code>{s.approved_by}</code> on{" "}
                  <time dateTime={s.approved_at}>{s.approved_at}</time>.
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Candidate shortlist</h2>
        <p>
          The shortlist below is the output of{" "}
          <a href="https://github.com/thenewforktimes/contentRX/blob/main/tools/case_study_candidates.py">
            <code>tools/case_study_candidates.py</code>
          </a>
          , which scores every repo in{" "}
          <a href="https://github.com/thenewforktimes/contentRX/blob/main/external_signal/allow_list.json">
            <code>external_signal/allow_list.json</code>
          </a>{" "}
          by the count of quality signals
          (content-designer presence, active i18n, content-design blog)
          and license permissiveness. Surfacing the shortlist
          publicly is part of the transparency commitment — anyone
          can see which projects are being considered and object
          before outreach starts.
        </p>
        {candidates ? (
          <>
            <p className="text-sm text-neutral-500">
              Shortlist generated{" "}
              <time dateTime={candidates.generated_at}>
                {candidates.generated_at.slice(0, 10)}
              </time>
              .
            </p>
            <ol>
              {candidates.top.map((c) => (
                <li key={`${c.owner}/${c.name}`}>
                  <a
                    href={`https://github.com/${c.owner}/${c.name}`}
                    className="font-mono"
                  >
                    {c.owner}/{c.name}
                  </a>{" "}
                  — {c.reason}
                  <br />
                  <span className="text-xs text-neutral-500">
                    Signals:{" "}
                    {[
                      c.quality_signals.has_content_designer && "content designer",
                      c.quality_signals.active_i18n && "active i18n",
                      c.quality_signals.content_design_blog && "content-design blog",
                    ]
                      .filter(Boolean)
                      .join(" · ") || "none"}{" "}
                    · license <code>{c.license}</code> · score {c.score}
                  </span>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p>
            <em>
              Shortlist not yet generated. Run{" "}
              <code>python3 tools/case_study_candidates.py</code>
              {" "}and commit the output at{" "}
              <code>evals/case_study_candidates.json</code>.
            </em>
          </p>
        )}
      </section>

      <section>
        <h2>How case studies get published</h2>
        <p>
          The publishing workflow is on Robo&apos;s side, not automated:
        </p>
        <ol>
          <li>Pick a candidate from the shortlist.</li>
          <li>
            Contact the maintainers via the repo&apos;s issue tracker
            or a public channel. Get <strong>explicit written approval</strong>{" "}
            before any evaluation runs against their strings.
          </li>
          <li>
            Run ContentRX against the project and draft the MDX at{" "}
            <code>docs-site/app/case-studies/&lt;slug&gt;/page.mdx</code>
            {" "}using the template at{" "}
            <a href="https://github.com/thenewforktimes/contentRX/blob/main/docs-site/content/case-studies/_template.mdx">
              <code>docs-site/content/case-studies/_template.mdx</code>
            </a>
            .
          </li>
          <li>
            Add an entry to the <code>CASE_STUDIES</code> registry with{" "}
            <code>maintainer_approval: true</code>,{" "}
            <code>approved_by</code>, and <code>approved_at</code>. The
            CI guard in{" "}
            <code>scripts/check_case_study_approval.py</code> rejects
            any registry entry missing those fields.
          </li>
          <li>Open the PR. Three judgment-calls minimum per study.</li>
        </ol>
      </section>

      <hr />
      <p className="text-sm">
        <Link href="/model">← The content model</Link>
      </p>
    </>
  );
}
