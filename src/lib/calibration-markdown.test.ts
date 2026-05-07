/**
 * Tests for the calibration-log markdown parser.
 *
 * The renderer's JSX output is exercised at the page level (visual);
 * this suite pins the pure parser logic — block extraction, the
 * timestamp pull, and inline-token splitting — against the templated
 * shape `reports/calibration/generate.py` emits.
 */

import { describe, expect, it } from "vitest";
import {
  parseCalibrationMarkdown,
  renderInline,
} from "./calibration-markdown";

const SAMPLE = `# Calibration log — 2026-19

_Generated 2026-05-07T02:28:53Z._

## Measured system κ

- _Pending — no accuracy snapshot available this week._

## Drift

- Self-drift κ = 0.575 (Robert vs past-Robert on the held-out panel).

## Coverage

- Standards measured: **0** of 47.
- By graduation level: 0 autonomous, 0 batch_approval, 43 robo_labels.

## Active refinements

- Open: **1**. Top three by recency:
  - REF-001: ui_label → ui_label + section_header

## Override stream

- Override-by-subtype rollups land once the substrate API exposes them. Until then refer to \`/admin/queue\` for the live count.
`;

describe("parseCalibrationMarkdown", () => {
  it("extracts the generated_at timestamp from the body", () => {
    const parsed = parseCalibrationMarkdown(SAMPLE);
    expect(parsed.generated_at).toBe("2026-05-07T02:28:53Z");
  });

  it("returns null generated_at when the body has no timestamp line", () => {
    const parsed = parseCalibrationMarkdown("# Calibration\n\n## Section\n");
    expect(parsed.generated_at).toBeNull();
  });

  it("skips the leading H1 (page header carries Week YYYY-WW)", () => {
    const parsed = parseCalibrationMarkdown(SAMPLE);
    // None of the blocks should be the H1 line.
    const h1Block = parsed.blocks.find(
      (b) => b.type === "p" && b.inline.startsWith("# Calibration log"),
    );
    expect(h1Block).toBeUndefined();
  });

  it("parses every ## section as an h2 block", () => {
    const parsed = parseCalibrationMarkdown(SAMPLE);
    const h2s = parsed.blocks
      .filter((b) => b.type === "h2")
      .map((b) => (b.type === "h2" ? b.text : ""));
    expect(h2s).toEqual([
      "Measured system κ",
      "Drift",
      "Coverage",
      "Active refinements",
      "Override stream",
    ]);
  });

  it("groups consecutive bullets into a single ul block", () => {
    const md = "## A\n\n- one\n- two\n- three\n\n## B\n\n- four\n";
    const parsed = parseCalibrationMarkdown(md);
    const uls = parsed.blocks.filter((b) => b.type === "ul");
    expect(uls).toHaveLength(2);
    const first = uls[0];
    expect(first.type).toBe("ul");
    if (first.type === "ul") {
      expect(first.items.map((i) => i.inline)).toEqual([
        "one",
        "two",
        "three",
      ]);
    }
  });

  it("keeps two-space-indented bullets as nested children", () => {
    const parsed = parseCalibrationMarkdown(SAMPLE);
    const refinementsIdx = parsed.blocks.findIndex(
      (b) => b.type === "h2" && b.text === "Active refinements",
    );
    expect(refinementsIdx).toBeGreaterThan(-1);
    const next = parsed.blocks[refinementsIdx + 1];
    expect(next.type).toBe("ul");
    if (next.type === "ul") {
      expect(next.items[0].inline).toMatch(/Open: \*\*1\*\*/);
      expect(next.items[0].children).toHaveLength(1);
      expect(next.items[0].children[0].inline).toMatch(/REF-001/);
    }
  });

  it("ignores blank lines between blocks", () => {
    const md = "## H\n\n\n\n- a\n";
    const parsed = parseCalibrationMarkdown(md);
    expect(parsed.blocks).toHaveLength(2);
  });

  it("treats unrecognized non-empty lines as paragraphs", () => {
    const md = "Some intro text.\n## Section\n- bullet\n";
    const parsed = parseCalibrationMarkdown(md);
    expect(parsed.blocks[0]).toEqual({ type: "p", inline: "Some intro text." });
  });
});

describe("renderInline", () => {
  it("returns plain text unchanged when no markers are present", () => {
    const out = renderInline("just plain text", "k");
    expect(out).toEqual(["just plain text"]);
  });

  it("splits on **bold** delimiters", () => {
    const out = renderInline("Standards measured: **0** of 47.", "k");
    // ['Standards measured: ', <strong>0</strong>, ' of 47.']
    expect(out).toHaveLength(3);
    expect(out[0]).toBe("Standards measured: ");
    expect(out[2]).toBe(" of 47.");
  });

  it("splits on _italic_ delimiters", () => {
    const out = renderInline("- _Pending — no snapshot._", "k");
    expect(out.length).toBeGreaterThanOrEqual(2);
    // The italic chunk strips the underscores from its rendered text.
    const hasItalicNode = out.some(
      (n) =>
        typeof n === "object" &&
        n !== null &&
        "type" in (n as object) &&
        (n as { type: string }).type === "em",
    );
    expect(hasItalicNode).toBe(true);
  });

  it("splits on `code` delimiters", () => {
    const out = renderInline("see `/admin/queue` for the count.", "k");
    const hasCodeNode = out.some(
      (n) =>
        typeof n === "object" &&
        n !== null &&
        "type" in (n as object) &&
        (n as { type: string }).type === "code",
    );
    expect(hasCodeNode).toBe(true);
  });

  it("handles multiple inline markers in one line", () => {
    const out = renderInline(
      "**bold** and _italic_ and `code` together",
      "k",
    );
    // 3 marker tokens + 3 text-run separators between/after them
    // (no leading run because the line starts with a marker).
    expect(out).toHaveLength(6);
    // Check that each marker type lands in the right slot.
    const types = out.map((n) =>
      typeof n === "string"
        ? "text"
        : (n as { type: string }).type,
    );
    expect(types).toEqual(["strong", "text", "em", "text", "code", "text"]);
  });
});
