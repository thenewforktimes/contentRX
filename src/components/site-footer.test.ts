import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Site-footer copy-pin tests.
 *
 * The global footer is the canonical carrier of:
 *   - the accountability surface (Accuracy, Calibration, Ethics)
 *   - the policy surface (Privacy, Security)
 *   - the company surface (Status, contact email)
 *   - copyright + license attribution
 *
 * These tests pin the structural set: any future edit that drops a
 * trust-column link or removes the FSL license attribution fails the
 * suite. Prose inside the footer is editable; the link set is not,
 * because individual page tests now defer to this surface for
 * cross-page navigation (see e.g. src/app/(marketing)/accuracy/page.test.ts).
 *
 * 2026-05-06: /sources retired (ADR 2026-05-06). The transparency +
 * opt-out commitment folds into /ethics as Commitment 4; the route
 * now 308s to /ethics#no-stolen-content.
 */

const FOOTER_PATH = path.join(__dirname, "site-footer.tsx");

describe("site footer (src/components/site-footer.tsx)", () => {
  const source = fs.readFileSync(FOOTER_PATH, "utf-8");

  it("carries the Trust column with every accountability surface", () => {
    // 2026-05-11: Trust column reordered to Ethics → Privacy →
    // Security → Accuracy per Robo's footer-cleanup pass. Calibration
    // log folded into /accuracy as a section — no separate Trust link.
    for (const href of ["/ethics", "/privacy", "/security", "/accuracy"]) {
      expect(source).toContain(`href: "${href}"`);
    }
  });

  it("does not carry a /sources link (route retired 2026-05-06)", () => {
    // /sources retired per ADR 2026-05-06. The route 308s to
    // /ethics#no-stolen-content; the footer link must not return —
    // a stray re-add would imply the route is back.
    expect(source).not.toContain(`href: "/sources"`);
  });

  it("does not carry a /calibration link (folded into /accuracy 2026-05-11)", () => {
    // /calibration retired 2026-05-11. The weekly calibration log
    // folded into /accuracy as a dedicated section; the route 308s
    // to /accuracy#calibration-log. Footer link must not return.
    expect(source).not.toContain(`href: "/calibration"`);
  });

  it("carries the Product column with the buyable surfaces", () => {
    for (const href of ["/pricing", "/install", "/dashboard"]) {
      expect(source).toContain(`href: "${href}"`);
    }
  });

  it("carries the Company column with status + contact", () => {
    expect(source).toContain(`href: "/status"`);
    expect(source).toContain("mailto:hello@contentrx.io");
  });

  it("does not carry an /about link (route retired 2026-05-10)", () => {
    // /about retired 2026-05-10 — its two paragraphs duplicated
    // /ethics (calibration commitment) and /accuracy (the nightly
    // kappa publication), and the named-byline moat already lives
    // on the homepage. The route 308s to /ethics in next.config.ts;
    // the footer link must not return.
    expect(source).not.toContain(`href: "/about"`);
  });

  it("attributes the source-available license", () => {
    // FSL-1.1-MIT, the locked source-available license. If the
    // license URL or label changes, this test should be updated in
    // the same PR that updates LICENSE.
    expect(source).toContain("FSL-1.1-MIT");
    expect(source).toContain("LICENSE");
  });

  it("carries the trademark + copyright line", () => {
    expect(source).toMatch(/©\s*2026 Robert Ballard/);
    expect(source).toContain("ContentRX™");
  });
});
