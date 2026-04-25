import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  optionalEnv,
  requireEnv,
  validateRequiredEnvAtStartup,
} from "../require-env";

describe("requireEnv", () => {
  const original = process.env;
  beforeEach(() => {
    process.env = { ...original };
  });
  afterEach(() => {
    process.env = original;
  });

  it("returns the value when set", () => {
    process.env.TEST_VAR = "hello";
    expect(requireEnv("TEST_VAR")).toBe("hello");
  });

  it("throws when missing", () => {
    delete process.env.TEST_VAR;
    expect(() => requireEnv("TEST_VAR")).toThrow(/TEST_VAR/);
  });

  it("throws when empty string", () => {
    process.env.TEST_VAR = "";
    expect(() => requireEnv("TEST_VAR")).toThrow(/TEST_VAR/);
  });

  it("throws when whitespace-only", () => {
    process.env.TEST_VAR = "   ";
    expect(() => requireEnv("TEST_VAR")).toThrow(/TEST_VAR/);
  });

  it("returns whitespace-padded value as-is when non-empty", () => {
    process.env.TEST_VAR = "  has-content  ";
    expect(requireEnv("TEST_VAR")).toBe("  has-content  ");
  });
});

describe("optionalEnv", () => {
  const original = process.env;
  beforeEach(() => {
    process.env = { ...original };
  });
  afterEach(() => {
    process.env = original;
  });

  it("returns the value when set", () => {
    process.env.TEST_VAR = "hello";
    expect(optionalEnv("TEST_VAR")).toBe("hello");
  });

  it("returns undefined when missing", () => {
    delete process.env.TEST_VAR;
    expect(optionalEnv("TEST_VAR")).toBeUndefined();
  });

  it("returns undefined when empty string", () => {
    process.env.TEST_VAR = "";
    expect(optionalEnv("TEST_VAR")).toBeUndefined();
  });

  it("returns undefined when whitespace-only", () => {
    process.env.TEST_VAR = "   ";
    expect(optionalEnv("TEST_VAR")).toBeUndefined();
  });
});

describe("validateRequiredEnvAtStartup", () => {
  const original = process.env;
  beforeEach(() => {
    // Start each test with all required vars set to dummy values so we
    // can isolate which assertions individual tests care about.
    process.env = {
      ...original,
      DATABASE_URL: "postgres://x",
      CLERK_SECRET_KEY: "x",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "x",
      CLERK_WEBHOOK_SECRET: "x",
      ANTHROPIC_API_KEY: "x",
      INTERNAL_EVAL_SECRET: "x",
      RESEND_API_KEY: "x",
      EMAIL_FROM: "hello@example.com",
      NEXT_PUBLIC_APP_URL: "https://example.com",
      UPSTASH_REDIS_REST_URL: "https://x",
      UPSTASH_REDIS_REST_TOKEN: "x",
      KV_REST_API_URL: "",
      KV_REST_API_TOKEN: "",
    };
  });
  afterEach(() => {
    process.env = original;
  });

  it("passes when all required vars are set", () => {
    expect(() => validateRequiredEnvAtStartup()).not.toThrow();
  });

  it("fails when CLERK_WEBHOOK_SECRET is empty (the actual prod incident)", () => {
    process.env.CLERK_WEBHOOK_SECRET = "";
    expect(() => validateRequiredEnvAtStartup()).toThrow(
      /CLERK_WEBHOOK_SECRET/,
    );
  });

  it("fails when DATABASE_URL is missing", () => {
    delete process.env.DATABASE_URL;
    expect(() => validateRequiredEnvAtStartup()).toThrow(/DATABASE_URL/);
  });

  it("accepts KV_REST_API_* as Upstash alternative", () => {
    process.env.UPSTASH_REDIS_REST_URL = "";
    process.env.UPSTASH_REDIS_REST_TOKEN = "";
    process.env.KV_REST_API_URL = "https://x";
    process.env.KV_REST_API_TOKEN = "x";
    expect(() => validateRequiredEnvAtStartup()).not.toThrow();
  });

  it("fails when both Upstash naming schemes are empty", () => {
    process.env.UPSTASH_REDIS_REST_URL = "";
    process.env.UPSTASH_REDIS_REST_TOKEN = "";
    process.env.KV_REST_API_URL = "";
    process.env.KV_REST_API_TOKEN = "";
    expect(() => validateRequiredEnvAtStartup()).toThrow(/UPSTASH/);
  });

  it("aggregates multiple missing vars into one error", () => {
    process.env.DATABASE_URL = "";
    process.env.CLERK_SECRET_KEY = "";
    expect(() => validateRequiredEnvAtStartup()).toThrow(
      /DATABASE_URL.*CLERK_SECRET_KEY|CLERK_SECRET_KEY.*DATABASE_URL/,
    );
  });
});
