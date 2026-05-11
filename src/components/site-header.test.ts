import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Site-header copy-pin tests.
 *
 * The global header carries:
 *   - the ContentRX logo (always linked home)
 *   - the cross-page nav (Pricing, Install, Sign in)
 *   - the Try free CTA
 *
 * The link set is structural — pages defer to this surface for
 * "get me back to the rest of the site." Pin the routes; leave
 * prose editable.
 */

const HEADER_PATH = path.join(__dirname, "site-header.tsx");
const WORDMARK_PATH = path.join(__dirname, "wordmark.tsx");

describe("site header (src/components/site-header.tsx)", () => {
  const source = fs.readFileSync(HEADER_PATH, "utf-8");
  // 2026-05-06: the brand mark moved into <Wordmark>, which the
  // header now imports. The "linked home" assertion checks the
  // Wordmark component's link wiring, which is the canonical
  // source of truth for the brand-link contract.
  const wordmarkSource = fs.readFileSync(WORDMARK_PATH, "utf-8");

  it("links the ContentRX logo home", () => {
    // Header renders <Wordmark size="sm" /> which (with default
    // link=true) wraps the mark in <Link href="/"> with the
    // "ContentRX home" aria-label.
    expect(source).toContain("Wordmark");
    expect(wordmarkSource).toMatch(/href="\/"/);
    expect(wordmarkSource).toContain("ContentRX home");
  });

  it("carries the primary marketing nav", () => {
    for (const href of ["/pricing", "/install"]) {
      expect(source).toContain(`href="${href}"`);
    }
    // /about retired 2026-05-10 — redirect to /ethics in
    // next.config.ts. Pin the absence so the link can't drift back.
    expect(source).not.toContain(`href="/about"`);
  });

  it("carries the auth surfaces (sign in + try free)", () => {
    expect(source).toContain(`href="/sign-in"`);
    expect(source).toContain(`href="/sign-up"`);
  });
});
