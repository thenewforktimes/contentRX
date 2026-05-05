import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MOMENTS_PY_CITATIONS,
  STYLE_GUIDE_METADATA,
  aggregateSources,
  loadSourcesData,
  type RawInputs,
} from "./sources-data";

/**
 * Pins the full data flow for /sources.
 *
 *   - aggregateSources is pure: fixture in, shape out, deterministic.
 *   - MOMENTS_PY_CITATIONS mirrors `src/content_checker/moments.py`'s
 *     docstring. When someone edits the docstring list (or this file)
 *     the two must stay in sync; the regex-based extraction below is
 *     intentionally narrow to force a test failure when the docstring
 *     format changes, not a silent drift.
 *   - loadSourcesData is the build-time fs path; we call it once to
 *     confirm the committed corpus shape is what the page expects.
 */

function baseFixture(): RawInputs {
  return {
    standards: {
      version: "4.6.1",
      total_standards: 3,
      categories: [
        {
          standards: [
            { id: "CLR-01", sources: ["Mailchimp", "GOV.UK Style Guide"] },
            { id: "CLR-02", sources: ["Mailchimp"] },
            { id: "CLR-03" },
          ],
        },
      ],
    },
    pairs: {
      pairs: [
        {
          source_system: "Mailchimp",
          license: "CC-BY-NC-ND-4.0",
        },
        {
          source_system: "Apple HIG",
          license: "all-rights-reserved",
        },
      ],
    },
    allow_list: {
      repos: [
        {
          owner: "vercel",
          name: "next.js",
          license: "MIT",
          content_paths: ["docs"],
          reason: "Flagship repo.",
          quality_signals: {
            has_content_designer: true,
            active_i18n: true,
            content_design_blog: true,
          },
        },
        {
          owner: "radix-ui",
          name: "primitives",
          license: "MIT",
          content_paths: ["packages"],
          reason: "Headless primitives.",
          quality_signals: {
            has_content_designer: false,
            active_i18n: false,
            content_design_blog: false,
          },
        },
      ],
    },
    moments_citations: ["Mailchimp", "Apple HIG", "GOV.UK Style Guide"],
    last_crawl: { "vercel/next.js": "2026-04-20T12:00:00Z" },
  };
}

describe("aggregateSources", () => {
  it("tallies standards_count and examples_count per source", () => {
    const out = aggregateSources(baseFixture(), "2026-04-23T00:00:00Z");

    const mailchimp = out.style_guides.find((s) => s.name === "Mailchimp");
    expect(mailchimp).toBeDefined();
    expect(mailchimp!.standards_count).toBe(2);
    expect(mailchimp!.examples_count).toBe(1);
    expect(mailchimp!.license).toBe("CC-BY-NC-ND-4.0");
    expect(mailchimp!.homepage_url).toMatch(/^https:\/\//);
    expect(mailchimp!.roles).toEqual(
      expect.arrayContaining([
        "standard_influences",
        "examples_corpus",
        "moment_weights",
      ]),
    );

    const govuk = out.style_guides.find((s) => s.name === "GOV.UK Style Guide");
    expect(govuk!.standards_count).toBe(1);
    expect(govuk!.examples_count).toBe(0);
    expect(govuk!.roles).toEqual(
      expect.arrayContaining(["standard_influences", "moment_weights"]),
    );
    expect(govuk!.roles).not.toContain("examples_corpus");
  });

  it("records metadata counters", () => {
    const out = aggregateSources(baseFixture(), "2026-04-23T00:00:00Z");
    expect(out.standards_total).toBe(3);
    expect(out.standards_with_attribution).toBe(2);
    expect(out.pairs_total).toBe(2);
    expect(out.generated_at).toBe("2026-04-23T00:00:00Z");
  });

  it("sorts style_guides by total contribution, ties broken by name", () => {
    const out = aggregateSources(baseFixture(), "2026-04-23T00:00:00Z");
    expect(out.style_guides.map((s) => s.name)).toEqual([
      "Mailchimp",
      "Apple HIG",
      "GOV.UK Style Guide",
    ]);
  });

  it("stitches last_crawl timestamps onto oss_repos; null when absent", () => {
    const out = aggregateSources(baseFixture(), "2026-04-23T00:00:00Z");
    expect(out.oss_repos.map((r) => `${r.owner}/${r.name}`)).toEqual([
      "radix-ui/primitives",
      "vercel/next.js",
    ]);
    const next = out.oss_repos.find((r) => r.name === "next.js")!;
    expect(next.last_crawl_at).toBe("2026-04-20T12:00:00Z");
    const radix = out.oss_repos.find((r) => r.name === "primitives")!;
    expect(radix.last_crawl_at).toBeNull();
  });

  it("throws when a source is missing from STYLE_GUIDE_METADATA", () => {
    const fix = baseFixture();
    fix.standards.categories[0]!.standards[0]!.sources = ["Invented Guide"];
    expect(() => aggregateSources(fix)).toThrow(/STYLE_GUIDE_METADATA/);
  });

  it("throws when pairs.json carries a license that conflicts with metadata", () => {
    const fix = baseFixture();
    fix.pairs.pairs[0]!.license = "MIT";
    expect(() => aggregateSources(fix)).toThrow(/license mismatch/);
  });

  it("throws when the same source has inconsistent licenses inside pairs.json", () => {
    const fix = baseFixture();
    fix.pairs.pairs.push({
      source_system: "Mailchimp",
      license: "MIT",
    });
    expect(() => aggregateSources(fix)).toThrow(/inconsistent license/);
  });
});

describe("MOMENTS_PY_CITATIONS", () => {
  it("matches the list in src/content_checker/moments.py docstring", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src", "content_checker", "moments.py"),
      "utf-8",
    );

    const lines = src.split(/\r?\n/);
    const end = lines.findIndex((ln) => ln.includes('"""'));
    const docstringHead = lines.slice(0, Math.max(end, 80));
    const cited = docstringHead
      .filter((ln) => /^\s+- /.test(ln))
      .map((ln) => ln.replace(/^\s+- /, "").split(" — ")[0]!.trim())
      .map((name) => (name === "Mailchimp Content Style Guide" ? "Mailchimp" : name));

    expect(cited).toEqual([...MOMENTS_PY_CITATIONS]);
  });
});

describe("STYLE_GUIDE_METADATA", () => {
  it("has an entry for every source named in standards_library.json and pairs.json", () => {
    const data = loadSourcesData();
    for (const s of data.style_guides) {
      expect(STYLE_GUIDE_METADATA[s.name]).toBeDefined();
    }
  });

  it("every entry uses an https URL", () => {
    for (const [, meta] of Object.entries(STYLE_GUIDE_METADATA)) {
      expect(meta.homepage_url).toMatch(/^https:\/\//);
    }
  });
});

describe("loadSourcesData (committed corpus)", () => {
  it("loads 13 unique style guides", () => {
    // v4.7.2: removed "ContentRX house style" entry — we don't say
    // "house style" anywhere customer-facing, and the public /sources
    // page renders this list.
    const data = loadSourcesData();
    expect(data.style_guides).toHaveLength(13);
  });

  it("loads the 20 allow-list OSS repos (Session 15)", () => {
    const data = loadSourcesData();
    expect(data.oss_repos).toHaveLength(20);
  });

  it("carries the v4.7.2 attribution-coverage numbers", () => {
    // v4.7.2: GRM-07's sole "ContentRX house style" attribution was
    // removed (rule is internal-only now), dropping standards_with_attribution
    // from 32 to 31. ACC-08 retains Apple HIG + Material Design.
    const data = loadSourcesData();
    expect(data.standards_total).toBe(49);
    expect(data.standards_with_attribution).toBe(31);
    expect(data.pairs_total).toBe(38);
  });
});
