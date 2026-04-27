/**
 * Pure-function tests for domain-grouping primitives. The DB-touching
 * helper (maybeGroupByDomain) is exercised by the Stripe-webhook
 * test path; this file pins the email-parsing + corporate-domain
 * detection rules so a regression in the DENY list shows up loudly.
 */

import { describe, expect, it } from "vitest";
import { emailDomain, isCorporateDomain } from "./domain-grouping";

describe("emailDomain", () => {
  it("extracts the domain after the last @", () => {
    expect(emailDomain("alice@acme.com")).toBe("acme.com");
  });

  it("lowercases", () => {
    expect(emailDomain("Alice@ACME.com")).toBe("acme.com");
  });

  it("trims whitespace around the domain", () => {
    expect(emailDomain("alice@ acme.com ")).toBe("acme.com");
  });

  it("handles emails with multiple @ characters by taking the last one", () => {
    expect(emailDomain("alice+tag@@acme.com")).toBe("acme.com");
  });

  it("returns empty string for malformed input", () => {
    expect(emailDomain("not-an-email")).toBe("");
    expect(emailDomain("")).toBe("");
  });
});

describe("isCorporateDomain", () => {
  it("returns true for unknown domains (treated as corporate)", () => {
    expect(isCorporateDomain("acme.com")).toBe(true);
    expect(isCorporateDomain("stripe.com")).toBe(true);
    expect(isCorporateDomain("smallcompany.io")).toBe(true);
  });

  it("returns false for major free email providers", () => {
    expect(isCorporateDomain("gmail.com")).toBe(false);
    expect(isCorporateDomain("outlook.com")).toBe(false);
    expect(isCorporateDomain("hotmail.com")).toBe(false);
    expect(isCorporateDomain("yahoo.com")).toBe(false);
    expect(isCorporateDomain("icloud.com")).toBe(false);
    expect(isCorporateDomain("protonmail.com")).toBe(false);
    expect(isCorporateDomain("aol.com")).toBe(false);
  });

  it("returns false for empty or invalid domains", () => {
    expect(isCorporateDomain("")).toBe(false);
  });

  it("is case-sensitive against the lowercased DENY list — caller is expected to pass already-lowercased input", () => {
    // The expected upstream is `emailDomain()` which lowercases. We
    // don't double-lower here to avoid hiding a caller bug. Documenting
    // the contract via this test.
    expect(isCorporateDomain("GMAIL.COM")).toBe(true);
  });
});
