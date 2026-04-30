import { describe, expect, it } from "vitest";
import {
  PILOT_CORRECTIONS_SCHEMA_VERSION,
  emptyCorrectionsFile,
  mergeCorrections,
  serializeCorrections,
  type ExportableRow,
} from "./corpus-export";

const baseRow: ExportableRow = {
  id: "ovr_a",
  standardId: "ACT-01",
  moment: "error_recovery",
  text: "Save changes",
  overrideReasonCode: "not_applicable_here",
  overrideReason: null,
  sourceUserId: "user_a",
  sourceTeamId: "team_a",
  triagedAt: new Date("2026-04-30T18:00:00Z"),
};

const now = new Date("2026-04-30T20:00:00Z");

describe("emptyCorrectionsFile()", () => {
  it("returns a well-formed empty file", () => {
    const file = emptyCorrectionsFile(now);
    expect(file.schema_version).toBe(PILOT_CORRECTIONS_SCHEMA_VERSION);
    expect(file.corrections).toEqual([]);
    expect(file.generated_at).toBe("2026-04-30T20:00:00.000Z");
    expect(file.description).toMatch(/Pilot corrections/);
  });
});

describe("mergeCorrections()", () => {
  it("appends new rows when the file was empty", () => {
    const existing = emptyCorrectionsFile(new Date("2026-04-29T00:00:00Z"));
    const result = mergeCorrections(existing, [baseRow], now);
    expect(result.added).toHaveLength(1);
    expect(result.updated).toHaveLength(0);
    expect(result.unchanged).toHaveLength(0);
    expect(result.file.corrections).toHaveLength(1);
    expect(result.file.corrections[0]).toEqual({
      id: "ovr_a",
      standard_id: "ACT-01",
      moment: "error_recovery",
      text: "Save changes",
      human_verdict: "pass",
      override_reason_code: "not_applicable_here",
      override_reason: null,
      source_user_id: "user_a",
      source_team_id: "team_a",
      triaged_at: "2026-04-30T18:00:00.000Z",
      exported_at: "2026-04-30T20:00:00.000Z",
    });
  });

  it("preserves prior entries that aren't in the new batch", () => {
    const seed = mergeCorrections(emptyCorrectionsFile(now), [baseRow], now);
    const newer: ExportableRow = {
      ...baseRow,
      id: "ovr_b",
      text: "Try again",
      overrideReasonCode: "standard_too_strict",
    };
    const out = mergeCorrections(
      seed.file,
      [newer],
      new Date("2026-04-30T21:00:00Z"),
    );
    expect(out.added).toHaveLength(1);
    expect(out.added[0]?.id).toBe("ovr_b");
    expect(out.unchanged).toHaveLength(1);
    expect(out.unchanged[0]?.id).toBe("ovr_a");
    expect(out.file.corrections).toHaveLength(2);
  });

  it("is idempotent across re-runs with the same input", () => {
    const first = mergeCorrections(emptyCorrectionsFile(now), [baseRow], now);
    const second = mergeCorrections(
      first.file,
      [baseRow],
      new Date("2026-05-01T10:00:00Z"),
    );
    // Re-running with the same row produces no churn — exported_at
    // is preserved on the existing entry.
    expect(second.added).toHaveLength(0);
    expect(second.updated).toHaveLength(0);
    expect(second.unchanged).toHaveLength(1);
    expect(second.file.corrections[0]?.exported_at).toBe(
      "2026-04-30T20:00:00.000Z",
    );
  });

  it("updates entries whose payload changed", () => {
    const first = mergeCorrections(emptyCorrectionsFile(now), [baseRow], now);
    const edited: ExportableRow = {
      ...baseRow,
      overrideReason: "Pilot added a clarifying note",
    };
    const second = mergeCorrections(
      first.file,
      [edited],
      new Date("2026-05-01T10:00:00Z"),
    );
    expect(second.added).toHaveLength(0);
    expect(second.updated).toHaveLength(1);
    expect(second.file.corrections[0]?.override_reason).toBe(
      "Pilot added a clarifying note",
    );
    // The exported_at on the updated row reflects the new run.
    expect(second.file.corrections[0]?.exported_at).toBe(
      "2026-05-01T10:00:00.000Z",
    );
  });

  it("sorts corrections by id for deterministic output", () => {
    const rowB: ExportableRow = { ...baseRow, id: "ovr_b" };
    const rowC: ExportableRow = { ...baseRow, id: "ovr_c" };
    const result = mergeCorrections(
      emptyCorrectionsFile(now),
      [rowC, baseRow, rowB],
      now,
    );
    expect(result.file.corrections.map((e) => e.id)).toEqual([
      "ovr_a",
      "ovr_b",
      "ovr_c",
    ]);
  });
});

describe("serializeCorrections()", () => {
  it("produces a stable string with trailing newline", () => {
    const file = emptyCorrectionsFile(now);
    const s = serializeCorrections(file);
    expect(s.endsWith("\n")).toBe(true);
    expect(JSON.parse(s)).toEqual(file);
  });

  it("two re-runs with identical inputs produce identical bytes", () => {
    const seedNow = new Date("2026-04-30T20:00:00Z");
    const a = mergeCorrections(
      emptyCorrectionsFile(seedNow),
      [baseRow],
      seedNow,
    );
    const b = mergeCorrections(
      emptyCorrectionsFile(seedNow),
      [baseRow],
      seedNow,
    );
    expect(serializeCorrections(a.file)).toBe(serializeCorrections(b.file));
  });
});
