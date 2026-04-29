import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Site-header copy-pin tests.
 *
 * The global header carries:
 *   - the ContentRX logo (always linked home)
 *   - the cross-page nav (Pricing, Install, About, Sign in)
 *   - the Try free CTA
 *
 * The link set is structural — pages defer to this surface for
 * "get me back to the rest of the site." Pin the routes; leave
 * prose editable.
 */

const HEADER_PATH = path.join(__dirname, "site-header.tsx");

describe("site header (src/components/site-header.tsx)", () => {
  const source = fs.readFileSync(HEADER_PATH, "utf-8");

  it("links the ContentRX logo home", () => {
    expect(source).toMatch(/href="\/"/);
    expect(source).toContain("ContentRX home");
  });

  it("carries the primary marketing nav", () => {
    for (const href of ["/pricing", "/install", "/about"]) {
      expect(source).toContain(`href="${href}"`);
    }
  });

  it("carries the auth surfaces (sign in + try free)", () => {
    expect(source).toContain(`href="/sign-in"`);
    expect(source).toContain(`href="/sign-up"`);
  });
});
