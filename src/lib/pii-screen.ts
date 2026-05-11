/**
 * Pre-screen for sensitive patterns at the public-API boundary.
 *
 * The strongest defense against accidentally reviewing a credit card,
 * SSN, or API key is refusing the request before it touches the
 * engine, Anthropic, Sentry, or function logs. This module is that
 * regex layer.
 *
 * Detection scope is deliberately narrow: high-confidence patterns
 * that have no business being in UI copy. We tolerate false negatives
 * (a passport number written as plain digits won't trip) over false
 * positives (a phone number tripping a credit-card check would block
 * legitimate copy). The policy is "obvious credentials and PII," not
 * "all numbers that could conceivably be sensitive."
 *
 * Patterns covered:
 *   - US SSN (3-2-4 hyphenated digits)
 *   - Credit / debit card numbers (Luhn-validated, 13–19 digits)
 *   - AWS access key IDs (`AKIA…`)
 *   - Stripe live/test keys (`sk_live_…`, `sk_test_…`)
 *   - OpenAI / generic `sk-…` API keys (32+ chars after prefix)
 *   - GitHub personal access tokens (`ghp_…`, `gho_…`, `ghs_…`)
 *
 * NOT covered (false-positive risk too high for current scope):
 *   - Phone numbers — legitimate in UI copy ("call 1-800-…")
 *   - Email addresses — legitimate in UI copy
 *   - Generic IDs / order numbers
 *   - Passport / driver's-license numbers (no canonical format)
 *
 * If a pattern fires, the caller (a route handler) returns 400 with a
 * plain-English message that names the kind of data, points the user
 * at a placeholder pattern they can use instead, and never echoes the
 * matched text back. The matched text doesn't go anywhere — not into
 * the response, not into any log line.
 */

export type SensitivePatternType =
  | "ssn"
  | "credit_card"
  | "aws_key"
  | "api_key";

interface PatternRule {
  type: SensitivePatternType;
  regex: RegExp;
  needsLuhn?: boolean;
}

const RULES: ReadonlyArray<PatternRule> = [
  // US Social Security Number — 3-2-4 with hyphens. The hyphenated
  // form is what people actually paste; bare 9 digits is too high a
  // false-positive surface (zip+4, order numbers, etc.).
  { type: "ssn", regex: /\b\d{3}-\d{2}-\d{4}\b/ },

  // Credit / debit card. 13–19 digits with optional whitespace or hyphen
  // between groups (e.g. `4242 4242-4242 4242`), Luhn-validated to
  // filter random number runs. Using `[\s-]` (not `[ -]`) so tabs and
  // newlines pasted mid-number still count as separators.
  { type: "credit_card", regex: /\b(?:\d[\s-]?){12,18}\d\b/, needsLuhn: true },

  // AWS Access Key ID — `AKIA` + 16 base32 chars.
  { type: "aws_key", regex: /\bAKIA[0-9A-Z]{16}\b/ },

  // Stripe live/test secret keys.
  { type: "api_key", regex: /\bsk_(?:live|test)_[A-Za-z0-9]{24,}\b/ },

  // OpenAI-style and generic `sk-…` keys (Anthropic uses `sk-ant-…`,
  // OpenAI uses `sk-…`, Replicate uses `r8_…`, etc.). 32+ chars is
  // the rough threshold below which we'd false-positive on
  // technical-doc strings like "see sk-12-3" comment markers.
  { type: "api_key", regex: /\bsk-[A-Za-z0-9_-]{32,}\b/ },

  // GitHub personal access tokens, OAuth tokens, server-side tokens.
  { type: "api_key", regex: /\bgh[pos]_[A-Za-z0-9]{36,}\b/ },
];

/**
 * Classic Luhn algorithm. Returns true when the digits in the input
 * (ignoring non-digit separators) check out. Used to filter random
 * 13–19 digit runs from genuine card numbers — without it, an order
 * ID like `1234567890123` would block as a credit card.
 */
function luhnValid(input: string): boolean {
  const digits = input.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

/**
 * Scan a single string for sensitive patterns. Returns the deduped
 * set of pattern types that fired. Empty array means clean.
 *
 * The matched substrings are intentionally NOT returned — callers
 * that need to surface "what kind" use the type label, never the
 * raw match. Echoing the matched value back to the user would
 * effectively confirm what was sensitive about their input, which
 * is the opposite of what this function is for.
 */
export function detectSensitivePatterns(text: string): SensitivePatternType[] {
  if (!text || text.length === 0) return [];
  const found = new Set<SensitivePatternType>();
  for (const { type, regex, needsLuhn } of RULES) {
    const match = text.match(regex);
    if (!match) continue;
    if (needsLuhn && !luhnValid(match[0])) continue;
    found.add(type);
  }
  return Array.from(found);
}

/**
 * Plain-English guidance for the response when a pattern fires. The
 * message names the kind of data we detected, suggests a placeholder,
 * and never echoes the matched text. Stable across pattern types so
 * the wire format is predictable.
 */
export function sensitiveDataErrorMessage(
  patterns: SensitivePatternType[],
): string {
  if (patterns.length === 0) {
    // Defensive — callers shouldn't invoke this with no patterns.
    return "Sensitive data detected.";
  }
  const labels: Record<SensitivePatternType, string> = {
    ssn: "Social Security Number",
    credit_card: "credit card number",
    aws_key: "AWS access key",
    api_key: "API key",
  };
  const named = patterns.map((p) => labels[p]).join(", ");
  return (
    `This looks like sensitive data (${named}), not UI copy. ContentRX ` +
    `evaluates content-design strings — checking credentials or PII isn't ` +
    `what we do. Replace the value with a placeholder ("****", "[redacted]", ` +
    `or a fake but realistic example) and try again.`
  );
}
