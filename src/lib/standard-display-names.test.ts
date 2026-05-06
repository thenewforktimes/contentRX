/**
 * Parity guard: the TS DISPLAY_LABELS map must match Python's
 * `src/content_checker/labels.py:DISPLAY_LABELS` exactly. This test
 * parses the Python source (it's a pure dict literal — no imports
 * needed) and compares.
 *
 * Catches the failure mode where one side adds a new standard, or
 * relabels an existing one, and the other surface keeps rendering
 * the stale label (or worse, the substrate ID via the fallback).
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  STANDARD_DISPLAY_LABELS,
  displayLabelFor,
} from "./standard-display-names";

const LABELS_PY_PATH = path.join(
  process.cwd(),
  "src",
  "content_checker",
  "labels.py",
);

function parsePythonDisplayLabels(): Record<string, string> {
  const source = fs.readFileSync(LABELS_PY_PATH, "utf-8");
  // Match the DISPLAY_LABELS = { ... } block. The dict literal is
  // pure key/value strings with comments — no expressions, so a
  // line-by-line regex is safe and avoids pulling in a Python parser.
  const blockMatch = source.match(
    /DISPLAY_LABELS:\s*dict\[str,\s*str\]\s*=\s*\{([\s\S]*?)\n\}/,
  );
  if (!blockMatch) {
    throw new Error(
      "Could not locate DISPLAY_LABELS block in labels.py — has the " +
        "shape changed? Update parsePythonDisplayLabels accordingly.",
    );
  }
  const body = blockMatch[1]!;
  const out: Record<string, string> = {};
  // Match each `"KEY": "VALUE",` line, ignoring comments and blanks.
  const lineRe = /"([A-Z]+-\d+)":\s*"([^"]+)",?/g;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(body)) !== null) {
    out[m[1]!] = m[2]!;
  }
  return out;
}

describe("STANDARD_DISPLAY_LABELS", () => {
  it("matches DISPLAY_LABELS in src/content_checker/labels.py", () => {
    const py = parsePythonDisplayLabels();
    expect(STANDARD_DISPLAY_LABELS).toStrictEqual(py);
  });

  it("displayLabelFor returns the label for a known standard", () => {
    expect(displayLabelFor("GRM-01")).toBe("Punctuation");
    expect(displayLabelFor("ACC-05")).toBe("Alt text");
  });

  it("falls back to the input id for unknown / team-custom rules", () => {
    expect(displayLabelFor("TEAM-01")).toBe("TEAM-01");
    expect(displayLabelFor("BOGUS-99")).toBe("BOGUS-99");
  });
});
