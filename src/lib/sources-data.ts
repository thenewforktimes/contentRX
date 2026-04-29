/**
 * /sources data aggregator.
 *
 * Human-eval build plan Session 19. Consolidates the committed
 * attribution metadata into the shape /sources renders:
 *
 *   - `src/content_checker/standards/standards_library.json`
 *     per-standard `sources` arrays (30/47 standards post-Session 16).
 *   - `evals/examples_corpus/pairs.json` — 38 before/after pairs, each
 *     carrying `source_system` + `license` (Session 16 seeding).
 *   - `src/content_checker/moments.py` module docstring — names 12
 *     style guides that shape moment-weight philosophy. We mirror that
 *     list here as a constant; a vitest check pins it so drift between
 *     the docstring and this constant is caught in CI.
 *   - `external_signal/allow_list.json` — 20 OSS repos on the content-
 *     mining allow-list (Session 15).
 *
 * The page is a Server Component; this module runs at build time only
 * and the aggregated output is baked into the static HTML. No runtime
 * fs reads, no per-request work.
 *
 * License + homepage metadata for each named style guide lives in the
 * `STYLE_GUIDE_METADATA` table below. Pairs.json is authoritative for
 * license on the 12 systems that appear in it; Chicago Manual of Style
 * appears only in standards_library and gets its license from the
 * metadata table.
 */

import fs from "node:fs";
import path from "node:path";

export type Role =
  | "standard_influences"
  | "examples_corpus"
  | "moment_weights"
  | "training_signal";

export interface StyleGuideSource {
  name: string;
  license: string;
  homepage_url: string;
  roles: Role[];
  standards_count: number;
  examples_count: number;
  cited_in_moment_weights: boolean;
}

export interface OSSRepoSource {
  owner: string;
  name: string;
  license: string;
  reason: string;
  quality_signals: {
    has_content_designer: boolean;
    active_i18n: boolean;
    content_design_blog: boolean;
  };
  last_crawl_at: string | null;
}

export interface SourcesData {
  style_guides: StyleGuideSource[];
  oss_repos: OSSRepoSource[];
  standards_total: number;
  standards_with_attribution: number;
  pairs_total: number;
  generated_at: string;
}

/**
 * Canonical list of design systems whose guidance informs moment
 * weights. Mirrors `src/content_checker/moments.py` module docstring
 * verbatim (Session 16). Pinned by a vitest test so drift is caught in
 * CI rather than silently diverging.
 */
export const MOMENTS_PY_CITATIONS: ReadonlyArray<string> = [
  "Mailchimp",
  "GOV.UK Style Guide",
  "18F Content Guide",
  "Microsoft Writing Style Guide",
  "Apple HIG",
  "Material Design",
  "Shopify Polaris",
  "Atlassian Design System",
  "GitHub Primer",
  "IBM Carbon",
  "USWDS",
  "Google Developer Documentation Style Guide",
];

/**
 * Public homepage + license for every named style guide. Licenses for
 * the 12 systems that also appear in pairs.json are cross-checked at
 * aggregation time — if pairs.json carries a different license for a
 * system, aggregation throws so the mismatch is caught in CI, not at
 * runtime.
 *
 * Robert: verify these URLs + licenses once before publishing. Each is
 * a well-known public style guide, but inline attribution is the
 * commitment from /ethics — accuracy matters.
 */
export const STYLE_GUIDE_METADATA: Record<
  string,
  { license: string; homepage_url: string }
> = {
  Mailchimp: {
    license: "CC-BY-NC-ND-4.0",
    homepage_url: "https://styleguide.mailchimp.com/",
  },
  "GOV.UK Style Guide": {
    license: "OGL-3.0",
    homepage_url: "https://www.gov.uk/guidance/style-guide",
  },
  "18F Content Guide": {
    license: "CC0-1.0",
    homepage_url: "https://content-guide.18f.gov/",
  },
  "Microsoft Writing Style Guide": {
    license: "CC-BY-4.0",
    homepage_url: "https://learn.microsoft.com/style-guide/welcome/",
  },
  "Apple HIG": {
    license: "all-rights-reserved",
    homepage_url: "https://developer.apple.com/design/human-interface-guidelines/",
  },
  "Material Design": {
    license: "CC-BY-4.0",
    homepage_url: "https://m3.material.io/",
  },
  "Shopify Polaris": {
    license: "all-rights-reserved",
    homepage_url: "https://polaris.shopify.com/",
  },
  "Atlassian Design System": {
    license: "all-rights-reserved",
    homepage_url: "https://atlassian.design/",
  },
  "GitHub Primer": {
    license: "all-rights-reserved",
    homepage_url: "https://primer.style/",
  },
  "IBM Carbon": {
    license: "all-rights-reserved",
    homepage_url: "https://carbondesignsystem.com/",
  },
  USWDS: {
    license: "CC0-1.0",
    homepage_url: "https://designsystem.digital.gov/",
  },
  "Google Developer Documentation Style Guide": {
    license: "CC-BY-4.0",
    homepage_url: "https://developers.google.com/style",
  },
  "Chicago Manual of Style": {
    license: "all-rights-reserved",
    homepage_url: "https://www.chicagomanualofstyle.org/",
  },
};

interface StandardsLibraryFile {
  version: string;
  total_standards: number;
  categories: Array<{
    standards: Array<{
      id: string;
      sources?: string[];
    }>;
  }>;
}

interface PairsFile {
  pairs: Array<{
    source_system: string;
    license: string;
  }>;
}

interface AllowListFile {
  repos: Array<{
    owner: string;
    name: string;
    license: string;
    content_paths: string[];
    reason: string;
    quality_signals: {
      has_content_designer: boolean;
      active_i18n: boolean;
      content_design_blog: boolean;
    };
  }>;
}

export interface RawInputs {
  standards: StandardsLibraryFile;
  pairs: PairsFile;
  allow_list: AllowListFile;
  moments_citations: ReadonlyArray<string>;
  /** ISO timestamps, keyed by "owner/name". Optional — missing means "not yet crawled". */
  last_crawl: Record<string, string>;
}

/**
 * Pure aggregator. Separated from fs reads so tests can supply
 * in-memory fixtures without touching disk.
 */
export function aggregateSources(
  raw: RawInputs,
  nowIso: string = new Date().toISOString(),
): SourcesData {
  const standardsBySource = new Map<string, number>();
  let standardsWithAttribution = 0;

  for (const cat of raw.standards.categories) {
    for (const std of cat.standards) {
      const sources = std.sources ?? [];
      if (sources.length > 0) standardsWithAttribution += 1;
      for (const name of sources) {
        standardsBySource.set(name, (standardsBySource.get(name) ?? 0) + 1);
      }
    }
  }

  const pairsBySource = new Map<string, { count: number; license: string }>();
  for (const pair of raw.pairs.pairs) {
    const entry = pairsBySource.get(pair.source_system) ?? {
      count: 0,
      license: pair.license,
    };
    entry.count += 1;
    if (entry.license !== pair.license) {
      throw new Error(
        `inconsistent license for ${pair.source_system} in pairs.json: saw ${entry.license} and ${pair.license}`,
      );
    }
    pairsBySource.set(pair.source_system, entry);
  }

  const allNames = new Set<string>([
    ...standardsBySource.keys(),
    ...pairsBySource.keys(),
    ...raw.moments_citations,
  ]);

  const style_guides: StyleGuideSource[] = [];
  for (const name of allNames) {
    const metadata = STYLE_GUIDE_METADATA[name];
    if (!metadata) {
      throw new Error(
        `missing STYLE_GUIDE_METADATA entry for "${name}". Add homepage_url + license to sources-data.ts.`,
      );
    }
    const pairsEntry = pairsBySource.get(name);
    if (pairsEntry && pairsEntry.license !== metadata.license) {
      throw new Error(
        `license mismatch for "${name}": pairs.json says ${pairsEntry.license}, STYLE_GUIDE_METADATA says ${metadata.license}`,
      );
    }

    const standards_count = standardsBySource.get(name) ?? 0;
    const examples_count = pairsEntry?.count ?? 0;
    const cited_in_moment_weights = raw.moments_citations.includes(name);

    const roles: Role[] = [];
    if (standards_count > 0) roles.push("standard_influences");
    if (examples_count > 0) roles.push("examples_corpus");
    if (cited_in_moment_weights) roles.push("moment_weights");

    style_guides.push({
      name,
      license: metadata.license,
      homepage_url: metadata.homepage_url,
      roles,
      standards_count,
      examples_count,
      cited_in_moment_weights,
    });
  }

  style_guides.sort((a, b) => {
    const totalDiff =
      b.standards_count + b.examples_count - (a.standards_count + a.examples_count);
    if (totalDiff !== 0) return totalDiff;
    return a.name.localeCompare(b.name);
  });

  const oss_repos: OSSRepoSource[] = raw.allow_list.repos
    .map((r) => ({
      owner: r.owner,
      name: r.name,
      license: r.license,
      reason: r.reason,
      quality_signals: r.quality_signals,
      last_crawl_at: raw.last_crawl[`${r.owner}/${r.name}`] ?? null,
    }))
    .sort((a, b) => `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`));

  return {
    style_guides,
    oss_repos,
    standards_total: raw.standards.total_standards,
    standards_with_attribution: standardsWithAttribution,
    pairs_total: raw.pairs.pairs.length,
    generated_at: nowIso,
  };
}

function readJson<T>(relPath: string): T {
  const full = path.join(process.cwd(), relPath);
  return JSON.parse(fs.readFileSync(full, "utf-8")) as T;
}

function readLastCrawlIndex(): Record<string, string> {
  const dir = path.join(process.cwd(), "external_signal", "output");
  const out: Record<string, string> = {};
  if (!fs.existsSync(dir)) return out;
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return out;
  }
  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, f), "utf-8");
      const parsed = JSON.parse(raw) as {
        repo?: { owner?: string; name?: string };
        crawled_at?: string;
      };
      if (parsed.repo?.owner && parsed.repo?.name && parsed.crawled_at) {
        const key = `${parsed.repo.owner}/${parsed.repo.name}`;
        const existing = out[key];
        if (!existing || parsed.crawled_at > existing) {
          out[key] = parsed.crawled_at;
        }
      }
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * Build-time loader. Reads the committed data files from disk and
 * returns the aggregated view. Server-Component-only.
 */
export function loadSourcesData(): SourcesData {
  const standards = readJson<StandardsLibraryFile>(
    path.join("src", "content_checker", "standards", "private", "standards_library.json"),
  );
  const pairs = readJson<PairsFile>(
    path.join("evals", "examples_corpus", "pairs.json"),
  );
  const allow_list = readJson<AllowListFile>(
    path.join("external_signal", "allow_list.json"),
  );
  return aggregateSources({
    standards,
    pairs,
    allow_list,
    moments_citations: MOMENTS_PY_CITATIONS,
    last_crawl: readLastCrawlIndex(),
  });
}
