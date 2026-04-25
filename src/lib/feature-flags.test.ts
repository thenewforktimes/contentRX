import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isPublicTaxonomyEnabled } from "./feature-flags";

describe("isPublicTaxonomyEnabled", () => {
  const original = process.env;
  beforeEach(() => {
    process.env = { ...original };
  });
  afterEach(() => {
    process.env = original;
  });

  it("returns false when PUBLIC_TAXONOMY is unset", () => {
    delete process.env.PUBLIC_TAXONOMY;
    expect(isPublicTaxonomyEnabled()).toBe(false);
  });

  it("returns false for empty string", () => {
    process.env.PUBLIC_TAXONOMY = "";
    expect(isPublicTaxonomyEnabled()).toBe(false);
  });

  it("returns false for whitespace-only", () => {
    process.env.PUBLIC_TAXONOMY = "   ";
    expect(isPublicTaxonomyEnabled()).toBe(false);
  });

  it.each([["true"], ["True"], ["TRUE"], ["1"], ["yes"], ["YES"], ["on"], ["ON"]])(
    "returns true for truthy value %s",
    (value) => {
      process.env.PUBLIC_TAXONOMY = value;
      expect(isPublicTaxonomyEnabled()).toBe(true);
    },
  );

  it("tolerates surrounding whitespace on truthy values", () => {
    process.env.PUBLIC_TAXONOMY = "  true  ";
    expect(isPublicTaxonomyEnabled()).toBe(true);
  });

  it.each([
    ["false"],
    ["False"],
    ["0"],
    ["no"],
    ["off"],
    ["maybe"],
    ["TRUE_ISH"],
    ["y"],
    ["t"],
  ])(
    "returns false for falsy or unrecognized value %s (fail closed)",
    (value) => {
      // Fail-closed semantics: if someone sets PUBLIC_TAXONOMY="probably"
      // thinking it's enabled, the substrate stays private rather than leaking.
      process.env.PUBLIC_TAXONOMY = value;
      expect(isPublicTaxonomyEnabled()).toBe(false);
    },
  );

  it("reads at call time, not module-import time", () => {
    process.env.PUBLIC_TAXONOMY = "false";
    expect(isPublicTaxonomyEnabled()).toBe(false);

    process.env.PUBLIC_TAXONOMY = "true";
    expect(isPublicTaxonomyEnabled()).toBe(true);

    process.env.PUBLIC_TAXONOMY = "false";
    expect(isPublicTaxonomyEnabled()).toBe(false);
  });
});
