/**
 * Server-side fetch + sanitize for the Termageddon-managed disclaimer.
 *
 * Why this exists: the original implementation used Termageddon's
 * `<script src="...embed.js">` which (a) takes ~20 s to render in
 * production and (b) leaves a static "Loading the disclaimer..."
 * fallback in the meantime, making the page read as broken. The
 * subscription is paid and the policy text is what we want, so this
 * module fetches the same source HTML their script does — but on the
 * server, cached, with the policy body extracted and sanitized so it
 * paints on first byte instead of waiting on a client script load.
 *
 * Cache: Next.js ISR via `fetch(..., { next: { revalidate: 3600 } })`.
 * The page renders statically; the cache refreshes once per hour from
 * Termageddon's API. If they push a compliance update (state law
 * change, etc.), it lands on contentrx.io within the hour without
 * a redeploy. The Termageddon Disclaimer subscription is still
 * earning its keep — we just stopped letting their client-side
 * script set the user's perceived load time.
 *
 * Sanitization: sanitize-html with a tight allowlist (headings,
 * paragraphs, lists, links, emphasis). The library defaults already
 * strip <script> and <style> and event handlers; we tighten further
 * by allowlisting only the tags we expect Termageddon to ship. A
 * supply-chain compromise of Termageddon can't inject markup we
 * haven't pre-approved.
 *
 * Failure mode: if Termageddon's API is unreachable or returns
 * unparseable HTML, the helper returns `null` and the page renders
 * a graceful fallback that links to the canonical Termageddon-hosted
 * version. Same posture as the original embed's fallback link, just
 * never the default state.
 */

import sanitizeHtml from "sanitize-html";
import { logSafeError } from "@/lib/safe-error-log";

// Termageddon-issued policy id for ContentRX's disclaimer. Same value
// the original embed used. Kept here (server-only module) rather than
// in the page so the page file stays focused on presentation.
const TERMAGEDDON_DISCLAIMER_ID = "VVhseFZHZEVla3B6VEhwMVQzYzlQUT09";

const TERMAGEDDON_POLICY_URL = `https://policies.termageddon.com/api/policy/${TERMAGEDDON_DISCLAIMER_ID}`;

// 1 hour. Long enough to keep Termageddon's API quiet under normal
// traffic; short enough that a state-law compliance update lands
// within a reasonable window without a redeploy. Adjustable.
const REVALIDATE_SECONDS = 60 * 60;

// User-Agent identifies the fetcher as the ContentRX site rather
// than an opaque server. Helps Termageddon's support team correlate
// traffic patterns to a known customer if they ever ask.
const USER_AGENT = "ContentRX-SSR-Disclaimer/1.0 (+https://contentrx.io)";

export interface DisclaimerContent {
  /** Sanitized inner HTML of the policy body. Safe for
   *  `dangerouslySetInnerHTML`. */
  html: string;
  /** The canonical Termageddon-hosted policy URL. Surfaced as a
   *  fallback link beneath the rendered content. */
  canonicalUrl: string;
}

/**
 * Fetch the disclaimer from Termageddon, extract the policy body,
 * sanitize the HTML, and return it ready for render. Cached for one
 * hour via Next.js ISR.
 *
 * Returns `null` if the fetch fails or the policy body can't be
 * located in the response. The page treats null as the failure path
 * and renders the canonical-link fallback.
 */
export async function getDisclaimerContent(): Promise<DisclaimerContent | null> {
  try {
    const res = await fetch(TERMAGEDDON_POLICY_URL, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html, */*",
      },
      next: { revalidate: REVALIDATE_SECONDS },
    });

    if (!res.ok) {
      logSafeError(
        "[disclaimer] termageddon policy fetch returned non-200",
        new Error(`status=${res.status}`),
      );
      return null;
    }

    const raw = await res.text();
    const body = extractPolicyBody(raw);
    if (!body) {
      logSafeError(
        "[disclaimer] policy body not found in termageddon response",
        new Error("extract returned empty"),
      );
      return null;
    }

    return {
      html: sanitizePolicyHtml(body),
      canonicalUrl: TERMAGEDDON_POLICY_URL,
    };
  } catch (err) {
    logSafeError("[disclaimer] termageddon fetch failed", err);
    return null;
  }
}

/**
 * Extract the inner HTML of the policy_embed_div from Termageddon's
 * response. The response wraps the policy in:
 *
 *   <div id="<POLICY_ID>" class="policy_embed_div" ...>
 *     <style>... massive CSS reset scoped to the id ...</style>
 *     <h2>Disclaimer</h2>
 *     ... policy markup ...
 *   </div>
 *
 * We want the markup, not the CSS reset. The sanitizer drops <style>
 * regardless, so this regex only has to bound the *outer* div; the
 * inner cleanup happens in `sanitizePolicyHtml`.
 *
 * Exported for unit testing.
 */
export function extractPolicyBody(html: string): string | null {
  // Match `<div id="<POLICY_ID>" ...>` and capture everything up to
  // its matching `</div>`. Termageddon's response has the policy as
  // the last top-level div, so a greedy match through the final
  // </div> in the document is safe. Anchored to OUR policy id so a
  // future shape change is more likely to fail loudly (null return)
  // than silently grab the wrong block.
  const opener = new RegExp(
    `<div[^>]*\\bid=["']${TERMAGEDDON_DISCLAIMER_ID}["'][^>]*>`,
    "i",
  );
  const openMatch = html.match(opener);
  if (!openMatch || openMatch.index === undefined) return null;

  const startIdx = openMatch.index + openMatch[0].length;
  const after = html.slice(startIdx);
  // Termageddon's response wraps the policy in a single top-level
  // div. The last `</div>` in `after` is the closing one. (Any
  // future nesting changes will surface as a sanitizer-stripped
  // div, not a render bug.)
  const closeIdx = after.lastIndexOf("</div>");
  if (closeIdx === -1) return null;

  return after.slice(0, closeIdx).trim();
}

/**
 * Sanitize Termageddon's HTML through a strict allowlist. The
 * defaults already strip <script>, <style>, and on* event handlers;
 * we further pin the tag set so a future Termageddon-side change
 * can't sneak in markup we haven't reviewed.
 *
 * Exported for unit testing.
 */
export function sanitizePolicyHtml(dirty: string): string {
  return sanitizeHtml(dirty, {
    allowedTags: [
      "h1", "h2", "h3", "h4", "h5", "h6",
      "p", "br", "hr",
      "ul", "ol", "li",
      "a", "strong", "em", "b", "i", "u",
      "blockquote", "code",
    ],
    allowedAttributes: {
      a: ["href", "title", "rel", "target"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      // Force external links to open without leaking referrer or
      // window.opener access. Defense-in-depth; the link set is
      // small and curated, but this is cheap insurance.
      a: sanitizeHtml.simpleTransform("a", {
        rel: "noopener noreferrer",
        target: "_blank",
      }),
    },
    // Drop any attribute or class we didn't explicitly allow,
    // including Termageddon's id-scoped CSS hooks.
    allowedClasses: {},
  });
}
