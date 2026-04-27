/**
 * Pure tests for the word-level diff. Pinned because every surface
 * (dashboard, Figma, Action, LSP) reads the same output — a regression
 * here would skew the highlighting across all four at once.
 */

import { describe, expect, it } from "vitest";
import { renderDiffMarkdown, wordDiff, type DiffToken } from "./text-diff";

describe("wordDiff", () => {
  it("returns no tokens for two empty strings", () => {
    expect(wordDiff("", "")).toEqual([]);
  });

  it("emits all-removed when after is empty", () => {
    expect(wordDiff("Click here", "")).toEqual<DiffToken[]>([
      { kind: "removed", text: "Click here" },
    ]);
  });

  it("emits all-added when before is empty", () => {
    expect(wordDiff("", "Sign up")).toEqual<DiffToken[]>([
      { kind: "added", text: "Sign up" },
    ]);
  });

  it("returns one equal token when strings match", () => {
    expect(wordDiff("Submit", "Submit")).toEqual<DiffToken[]>([
      { kind: "equal", text: "Submit" },
    ]);
  });

  it("highlights swapped words while keeping shared prefix/suffix equal", () => {
    // "Are you sure?" → "Delete this project?"
    const tokens = wordDiff("Are you sure?", "Delete this project?");
    // The "?" is shared — a real LCS hit.
    const equalSegments = tokens.filter((t) => t.kind === "equal");
    expect(equalSegments.length).toBeGreaterThan(0);
    expect(equalSegments.map((t) => t.text).join("")).toContain("?");
  });

  it("highlights only the changed words in a partial swap", () => {
    // "Click here" → "Click submit" — keeps "Click " equal, swaps "here"→"submit".
    const tokens = wordDiff("Click here", "Click submit");
    expect(tokens).toEqual<DiffToken[]>([
      { kind: "equal", text: "Click " },
      { kind: "removed", text: "here" },
      { kind: "added", text: "submit" },
    ]);
  });

  it("preserves whitespace runs in the equal path", () => {
    const tokens = wordDiff("a  b", "a  c");
    expect(tokens).toEqual<DiffToken[]>([
      { kind: "equal", text: "a  " },
      { kind: "removed", text: "b" },
      { kind: "added", text: "c" },
    ]);
  });

  it("merges adjacent tokens of the same kind into a single block", () => {
    // No shared tokens → entire `before` is one removed block, entire
    // `after` is one added block. Without merging, the spaces between
    // the words would each become their own token.
    const tokens = wordDiff("alpha beta gamma", "x");
    const removed = tokens.filter((t) => t.kind === "removed");
    const added = tokens.filter((t) => t.kind === "added");
    expect(removed.length).toBe(1);
    expect(removed[0].text).toBe("alpha beta gamma");
    expect(added.length).toBe(1);
    expect(added[0].text).toBe("x");
  });

  it("handles trailing punctuation as part of the same token", () => {
    // "delete this!" vs "remove this!" — the "!" is part of the ending
    // non-word run paired with " this" so it survives as equal.
    const tokens = wordDiff("delete this!", "remove this!");
    const equalText = tokens
      .filter((t) => t.kind === "equal")
      .map((t) => t.text)
      .join("");
    expect(equalText).toContain("this");
    expect(equalText).toContain("!");
  });

  it("handles word reordering by emitting remove + add (no fancy move detection)", () => {
    // "blue red" → "red blue" — LCS picks one as equal, the other gets
    // remove+add. We don't claim move detection.
    const tokens = wordDiff("blue red", "red blue");
    expect(tokens.some((t) => t.kind === "equal")).toBe(true);
    expect(tokens.some((t) => t.kind === "removed")).toBe(true);
    expect(tokens.some((t) => t.kind === "added")).toBe(true);
  });

  it("round-trips: equal+removed reconstructs `before`", () => {
    const before = "Confirm action: this will delete 47 documents";
    const after = "Delete project? You'll lose 47 documents and 12 collaborators";
    const tokens = wordDiff(before, after);
    const reconstructedBefore = tokens
      .filter((t) => t.kind === "equal" || t.kind === "removed")
      .map((t) => t.text)
      .join("");
    expect(reconstructedBefore).toBe(before);
  });

  it("round-trips: equal+added reconstructs `after`", () => {
    const before = "Confirm action: this will delete 47 documents";
    const after = "Delete project? You'll lose 47 documents and 12 collaborators";
    const tokens = wordDiff(before, after);
    const reconstructedAfter = tokens
      .filter((t) => t.kind === "equal" || t.kind === "added")
      .map((t) => t.text)
      .join("");
    expect(reconstructedAfter).toBe(after);
  });
});

describe("renderDiffMarkdown", () => {
  it("renders equal text as-is, removed as ~~strikethrough~~, added as **bold**", () => {
    const tokens: DiffToken[] = [
      { kind: "equal", text: "Click " },
      { kind: "removed", text: "here" },
      { kind: "added", text: "submit" },
    ];
    expect(renderDiffMarkdown(tokens)).toBe("Click ~~here~~**submit**");
  });

  it("returns the empty string for an empty token list", () => {
    expect(renderDiffMarkdown([])).toBe("");
  });

  it("doesn't escape markdown special characters in user text — caller's responsibility", () => {
    // Documenting the contract: caller must escape if the input might
    // contain markdown. For our use case the input is short UI copy.
    const tokens: DiffToken[] = [{ kind: "added", text: "**already bold**" }];
    expect(renderDiffMarkdown(tokens)).toBe("****already bold****");
  });
});
