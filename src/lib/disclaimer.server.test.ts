/**
 * Tests for the disclaimer SSR helper. The fetch + cache layer is
 * exercised in production against Termageddon's real API; these
 * tests pin the two riskier pure functions:
 *
 *   - extractPolicyBody  — regex-based slice of the policy body
 *                          out of Termageddon's wrapper HTML. A
 *                          future Termageddon shape change should
 *                          fail loudly here, not silently in prod.
 *   - sanitizePolicyHtml — allowlist guard. A regression that
 *                          loosens it would let a Termageddon-side
 *                          compromise inject markup we never
 *                          reviewed.
 */

import { describe, it, expect } from "vitest";
import { extractPolicyBody, sanitizePolicyHtml } from "./disclaimer.server";

const POLICY_ID = "VVhseFZHZEVla3B6VEhwMVQzYzlQUT09";

// Trimmed fixture mirroring the shape Termageddon's
// /api/policy/<id> endpoint returns: full HTML document with an
// outer <style> reset and the policy wrapped in a div keyed by the
// policy id.
const FIXTURE_POLICY_HTML = `<!DOCTYPE html><html><body>
<style>body { font-family: serif; }</style>
<div id="${POLICY_ID}" class="policy_embed_div" width="640" height="480">
<style>#${POLICY_ID} { color: red; }</style>
<h2>Disclaimer</h2>
<p>Last updated: May 12, 2026 3:12 PM</p>
<p>By accessing this Website, you agree to be bound by this Disclaimer.</p>
<h3>No legal advice</h3>
<p>Not intended as legal advice.</p>
<p>Policies powered by Termageddon</p>
</div>
<footer>Termageddon footer chrome</footer>
</body></html>`;

describe("extractPolicyBody", () => {
  it("returns the inner HTML of the policy div", () => {
    const body = extractPolicyBody(FIXTURE_POLICY_HTML);
    expect(body).not.toBeNull();
    expect(body).toContain("<h2>Disclaimer</h2>");
    expect(body).toContain("<h3>No legal advice</h3>");
    // The inner <style> tag is left for the sanitizer to strip.
    expect(body).toContain("<style>");
  });

  it("does not capture chrome outside the policy div", () => {
    const body = extractPolicyBody(FIXTURE_POLICY_HTML);
    expect(body).not.toContain("Termageddon footer chrome");
    expect(body).not.toContain("font-family: serif"); // outer <style>
  });

  it("returns null when the policy id is absent", () => {
    const html = `<!DOCTYPE html><html><body>
      <div id="some-other-id"><p>not the one</p></div>
    </body></html>`;
    expect(extractPolicyBody(html)).toBeNull();
  });

  it("returns null on empty / malformed input", () => {
    expect(extractPolicyBody("")).toBeNull();
    expect(extractPolicyBody("<html></html>")).toBeNull();
  });
});

describe("sanitizePolicyHtml", () => {
  it("strips <script> tags", () => {
    const dirty = `<p>safe</p><script>alert(1)</script><p>after</p>`;
    const clean = sanitizePolicyHtml(dirty);
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("alert(1)");
    expect(clean).toContain("<p>safe</p>");
    expect(clean).toContain("<p>after</p>");
  });

  it("strips <style> tags (the Termageddon CSS reset)", () => {
    const dirty = `<style>body { color: red; }</style><p>content</p>`;
    const clean = sanitizePolicyHtml(dirty);
    expect(clean).not.toContain("<style");
    expect(clean).not.toContain("color: red");
    expect(clean).toContain("<p>content</p>");
  });

  it("strips inline event handlers", () => {
    const dirty = `<p onclick="alert(1)">click me</p>`;
    const clean = sanitizePolicyHtml(dirty);
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("alert");
  });

  it("strips javascript: hrefs", () => {
    const dirty = `<a href="javascript:alert(1)">bad</a>`;
    const clean = sanitizePolicyHtml(dirty);
    expect(clean).not.toContain("javascript:");
  });

  it("forces rel=noopener noreferrer + target=_blank on links", () => {
    const dirty = `<a href="https://example.com">link</a>`;
    const clean = sanitizePolicyHtml(dirty);
    expect(clean).toContain('rel="noopener noreferrer"');
    expect(clean).toContain('target="_blank"');
  });

  it("preserves the headings + paragraphs + lists Termageddon ships", () => {
    const dirty = `
      <h2>Disclaimer</h2>
      <h3>No legal advice</h3>
      <p>Body copy with <strong>emphasis</strong> and <em>italics</em>.</p>
      <ul><li>Item one</li><li>Item two</li></ul>
    `;
    const clean = sanitizePolicyHtml(dirty);
    expect(clean).toContain("<h2>Disclaimer</h2>");
    expect(clean).toContain("<h3>No legal advice</h3>");
    expect(clean).toContain("<strong>emphasis</strong>");
    expect(clean).toContain("<em>italics</em>");
    expect(clean).toContain("<ul>");
    expect(clean).toContain("<li>Item one</li>");
  });

  it("end-to-end: extract + sanitize produces clean policy markup", () => {
    const body = extractPolicyBody(FIXTURE_POLICY_HTML);
    expect(body).not.toBeNull();
    const clean = sanitizePolicyHtml(body as string);
    expect(clean).toContain("<h2>Disclaimer</h2>");
    expect(clean).toContain("Not intended as legal advice");
    expect(clean).not.toContain("<style");
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("policy_embed_div"); // class attr dropped
  });
});
