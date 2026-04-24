import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Render-layer sanity: the /accuracy page must never publish a
 * composite "accuracy score." Session 24's acceptance criterion
 * explicitly calls out this invariant — combining the three kappa
 * numbers into one headline would misrepresent the measurement.
 *
 * This test greps the source file for the forbidden phrasing. It's a
 * coarser guarantee than render testing, but it's deterministic and
 * doesn't require a rendered DOM — the authorial discipline is the
 * real defence and this is the tripwire.
 */

const PAGE_PATH = path.join(
  __dirname,
  "page.tsx",
);

describe("/accuracy page source", () => {
  // Strip block + line comments so the grep reflects what end users
  // actually see in the rendered HTML. File-level JSDoc explicitly
  // names the pattern it's defending against — that's authorial
  // context, not published copy.
  const rawSource = fs.readFileSync(PAGE_PATH, "utf-8");
  const source = rawSource
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");

  it("only uses the phrase 'accuracy score' inside an explicit disclaimer", () => {
    // The page's accountability commitment is explicit: "no composite
    // accuracy score." The phrase is allowed only in contexts that
    // negate, deny, or warn against a composite score. A plain
    // declarative "accuracy score: 0.84" would miss every allow-list
    // marker below and fail this test — which is the point.
    const disclaimerMarkers = [
      /\bno composite\b/i,
      /\bnot a composite\b/i,
      /\bnever a composite\b/i,
      /&ldquo;accuracy score&rdquo;/i, // the phrase in quotes marks it as named, not asserted
      /\bsingle [\w -]*\s*&ldquo;accuracy score&rdquo;/i,
      /a single &ldquo;accuracy score&rdquo;/i,
    ];
    const offenders: string[] = [];
    const lines = source.split(/\r?\n/);
    for (const line of lines) {
      if (!/accuracy\s+score/i.test(line)) continue;
      if (disclaimerMarkers.some((re) => re.test(line))) continue;
      offenders.push(line.trim());
    }
    expect(offenders, "Unapproved 'accuracy score' phrasing:").toEqual([]);
  });

  it("labels the three metric blocks with distinct strings", () => {
    expect(source).toContain("Measured system κ");
    expect(source).toContain("Measured self-drift κ");
    expect(source).toContain("Design target κ");
  });

  it("renders the 95% CI marker when a kappa is measured", () => {
    expect(source).toContain("95% CI");
  });

  it("links the rest of the accountability surface (/ethics, /sources)", () => {
    expect(source).toContain("/ethics");
    expect(source).toContain("/sources");
  });
});
