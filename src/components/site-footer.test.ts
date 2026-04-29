import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Site-footer copy-pin tests.
 *
 * The global footer is the canonical carrier of:
 *   - the accountability surface (Accuracy, Calibration, Sources, Ethics)
 *   - the policy surface (Privacy, Security)
 *   - the company surface (About, Status, contact email)
 *   - copyright + license attribution
 *
 * These tests pin the structural set: any future edit that drops a
 * trust-column link or removes the FSL license attribution fails the
 * suite. Prose inside the footer is editable; the link set is not,
 * because individual page tests now defer to this surface for
 * cross-page navigation (see e.g. src/app/(marketing)/accuracy/page.test.ts).
 */

const FOOTER_PATH = path.join(__dirname, "site-footer.tsx");

describe("site footer (src/components/site-footer.tsx)", () => {
  const source = fs.readFileSync(FOOTER_PATH, "utf-8");

  it("carries the Trust column with every accountability surface", () => {
    for (const href of [
      "/accuracy",
      "/calibration",
      "/sources",
      "/ethics",
      "/privacy",
      "/security",
    ]) {
      expect(source).toContain(`href: "${href}"`);
    }
  });

  it("carries the Product column with the buyable surfaces", () => {
    for (const href of ["/pricing", "/install", "/dashboard"]) {
      expect(source).toContain(`href: "${href}"`);
    }
  });

  it("carries the Company column with about + status + contact", () => {
    expect(source).toContain(`href: "/about"`);
    expect(source).toContain(`href: "/status"`);
    expect(source).toContain("mailto:hello@contentrx.io");
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
