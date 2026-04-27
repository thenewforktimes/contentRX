import { describe, expect, it } from "vitest";
import { csvEscape, exportFilename, serializeCsv } from "./export";

describe("csvEscape", () => {
  it("returns empty string for null and undefined", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });

  it("returns plain values unquoted", () => {
    expect(csvEscape("hello")).toBe("hello");
    expect(csvEscape(42)).toBe("42");
    expect(csvEscape(true)).toBe("true");
  });

  it("quotes values containing commas", () => {
    expect(csvEscape("a, b")).toBe('"a, b"');
  });

  it("quotes values containing newlines", () => {
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
    expect(csvEscape("line1\rline2")).toBe('"line1\rline2"');
  });

  it("quotes values containing quotes and doubles internal quotes", () => {
    expect(csvEscape('he said "hi"')).toBe('"he said ""hi"""');
  });

  it("serializes Date as ISO string", () => {
    const d = new Date("2026-04-27T12:34:56.000Z");
    expect(csvEscape(d)).toBe("2026-04-27T12:34:56.000Z");
  });
});

describe("serializeCsv", () => {
  it("emits header + rows in header column order", () => {
    const out = serializeCsv(
      ["id", "name", "count"],
      [
        { id: "1", name: "Alice", count: 3 },
        { id: "2", name: "Bob", count: 7 },
      ],
    );
    expect(out).toBe("id,name,count\n1,Alice,3\n2,Bob,7\n");
  });

  it("handles missing keys as empty cells", () => {
    const out = serializeCsv(
      ["a", "b", "c"],
      [{ a: "x", c: "z" }],
    );
    expect(out).toBe("a,b,c\nx,,z\n");
  });

  it("escapes cells with delimiters", () => {
    const out = serializeCsv(
      ["text"],
      [{ text: 'has "quotes", commas, and\nnewlines' }],
    );
    expect(out).toBe('text\n"has ""quotes"", commas, and\nnewlines"\n');
  });

  it("handles empty rows array (just header)", () => {
    expect(serializeCsv(["a", "b"], [])).toBe("a,b\n");
  });
});

describe("exportFilename", () => {
  it("appends today's UTC date and the extension", () => {
    const f = exportFilename("overrides", "csv");
    // Match `overrides-YYYY-MM-DD.csv`
    expect(f).toMatch(/^overrides-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("uses the requested extension", () => {
    expect(exportFilename("verdicts-90d", "json")).toMatch(/\.json$/);
  });
});
