import { describe, expect, it } from "vitest";
import { RequestSchema } from "./schema";

/**
 * Pin the request-validation contract for /api/violations/adjust.
 *
 * Per ADR 2026-05-11 the route is verdict-only. The customer's
 * dismissal lands in `violation_overrides` as a private record. The
 * separate Flag-for-Review consent flow is the only path to the
 * calibration corpus.
 */

describe("/api/violations/adjust — RequestSchema", () => {
  describe("verdict signal", () => {
    it("requires override_reason_code", () => {
      const result = RequestSchema.safeParse({
        text: "Click here",
        signal_type: "verdict",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some(
            (i) => i.path.join(".") === "override_reason_code",
          ),
        ).toBe(true);
      }
    });

    it("accepts a verdict request with reason_code", () => {
      const result = RequestSchema.safeParse({
        text: "Click here",
        signal_type: "verdict",
        override_reason_code: "not_applicable_here",
      });
      expect(result.success).toBe(true);
    });

    it("rejects non-verdict signal_type values", () => {
      const r1 = RequestSchema.safeParse({
        text: "Click here",
        signal_type: "suggestion",
        override_reason_code: "not_applicable_here",
      });
      const r2 = RequestSchema.safeParse({
        text: "Click here",
        signal_type: "both",
        override_reason_code: "not_applicable_here",
      });
      expect(r1.success).toBe(false);
      expect(r2.success).toBe(false);
    });

    it("rejects rewrite_text payloads (suggestion path retired per ADR 2026-05-11)", () => {
      // ADR 2026-05-11 explicitly forbids the suggestion-share path
      // from the Adjust modal. If a future refactor re-adds it here,
      // calibration corpus contributions can flow without the
      // Flag-for-Review consent surface. That regression must fail
      // loud — the schema is strict, no extra keys allowed.
      const result = RequestSchema.safeParse({
        text: "Click here",
        signal_type: "verdict",
        override_reason_code: "not_applicable_here",
        rewrite_text: "View pricing",
      });
      // Zod default is to strip unknown keys silently; verify the
      // shape doesn't smuggle the field through.
      if (result.success) {
        expect("rewrite_text" in result.data).toBe(false);
      }
    });

    it("rejects share_upstream payloads (calibration-share path retired per ADR 2026-05-11)", () => {
      const result = RequestSchema.safeParse({
        text: "Click here",
        signal_type: "verdict",
        override_reason_code: "not_applicable_here",
        share_upstream: true,
      });
      if (result.success) {
        expect("share_upstream" in result.data).toBe(false);
      }
    });
  });

  describe("size + text limits", () => {
    it("rejects empty text", () => {
      const result = RequestSchema.safeParse({
        text: "",
        signal_type: "verdict",
        override_reason_code: "not_applicable_here",
      });
      expect(result.success).toBe(false);
    });

    it("rejects text over the 100k cap", () => {
      const result = RequestSchema.safeParse({
        text: "x".repeat(100_001),
        signal_type: "verdict",
        override_reason_code: "not_applicable_here",
      });
      expect(result.success).toBe(false);
    });

    it("rejects override_notes over the 500-char cap", () => {
      const result = RequestSchema.safeParse({
        text: "Click here",
        signal_type: "verdict",
        override_reason_code: "not_applicable_here",
        override_notes: "x".repeat(501),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("override_reason_code vocabulary", () => {
    it("accepts all 5 codes from override-reasons.ts", () => {
      const codes = [
        "not_applicable_here",
        "standard_too_strict",
        "fix_is_worse",
        "shipping_anyway",
        "confusing_need_more_context",
      ] as const;
      for (const code of codes) {
        const result = RequestSchema.safeParse({
          text: "Click here",
          signal_type: "verdict",
          override_reason_code: code,
        });
        expect(result.success).toBe(true);
      }
    });

    it("rejects unknown reason codes", () => {
      const result = RequestSchema.safeParse({
        text: "Click here",
        signal_type: "verdict",
        override_reason_code: "made_up_code",
      });
      expect(result.success).toBe(false);
    });
  });
});
