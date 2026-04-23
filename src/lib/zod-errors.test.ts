import { describe, it, expect } from "vitest";
import { z } from "zod";
import { sanitizeZodIssues } from "./zod-errors";

describe("sanitizeZodIssues", () => {
  it("strips the `received` field from invalid_type issues", () => {
    const result = z.object({ count: z.number() }).safeParse({ count: "not-a-number" });
    if (result.success) throw new Error("expected failure");

    const sanitized = sanitizeZodIssues(result.error.issues);
    expect(sanitized).toHaveLength(1);
    expect(sanitized[0]).toMatchObject({
      path: ["count"],
      code: "invalid_type",
    });
    // Critically: no `received` field leaking user input
    expect(sanitized[0]).not.toHaveProperty("received");
  });

  it("strips user-supplied strings from too_big issues", () => {
    const secretValue = "SHOULD_NOT_ECHO_BACK_secret_prompt_injection";
    const result = z.object({ text: z.string().max(5) }).safeParse({ text: secretValue });
    if (result.success) throw new Error("expected failure");

    const sanitized = sanitizeZodIssues(result.error.issues);
    const asString = JSON.stringify(sanitized);
    expect(asString).not.toContain(secretValue);
  });

  it("preserves enum values (public API contract) but not the rejected input", () => {
    const rejectedValue = "not_an_enum_value_private";
    const result = z
      .object({ mode: z.enum(["read", "write"]) })
      .safeParse({ mode: rejectedValue });
    if (result.success) throw new Error("expected failure");

    const sanitized = sanitizeZodIssues(result.error.issues);
    expect(sanitized[0]).toMatchObject({
      path: ["mode"],
      code: "invalid_value",
      values: ["read", "write"],
    });

    // The sanitized issue must not contain the user's rejected value.
    // (The zod v4 message field DOES include valid options but NOT the
    // rejected input; this assertion pins that contract.)
    const asString = JSON.stringify(sanitized);
    expect(asString).not.toContain(rejectedValue);
  });

  it("keeps path, code, and message — the fields a client actually needs", () => {
    const result = z.object({ age: z.number().min(18) }).safeParse({ age: 5 });
    if (result.success) throw new Error("expected failure");

    const sanitized = sanitizeZodIssues(result.error.issues);
    expect(sanitized[0].path).toEqual(["age"]);
    expect(sanitized[0].code).toBe("too_small");
    expect(typeof sanitized[0].message).toBe("string");
    expect(sanitized[0].message.length).toBeGreaterThan(0);
  });

  it("handles multiple issues in one error", () => {
    const result = z
      .object({
        text: z.string().max(5),
        count: z.number().min(0),
      })
      .safeParse({ text: "too-long-string", count: -1 });
    if (result.success) throw new Error("expected failure");

    const sanitized = sanitizeZodIssues(result.error.issues);
    expect(sanitized.length).toBe(2);
    const paths = sanitized.map((i) => i.path[0]);
    expect(paths).toContain("text");
    expect(paths).toContain("count");
  });
});
