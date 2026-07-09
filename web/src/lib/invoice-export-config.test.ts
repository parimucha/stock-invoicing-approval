import { describe, it, expect } from "vitest";
import { parseExportPresetConfig } from "./invoice-export-config";

function valid() {
  return {
    columnGroups: [
      { key: "FR", label: "FR", projectIds: ["french_pimcore", "sap_spirit_fr"] },
      { key: "GER", label: "GER", projectIds: ["german_pimcore"] },
    ],
    ticketColumns: ["month", "country", "ticket", "hours"],
    sheets: { tickets: true, overview: true },
    eurRate: 24.2,
  };
}

describe("parseExportPresetConfig", () => {
  it("accepts a valid config", () => {
    const cfg = parseExportPresetConfig(valid());
    expect(cfg.columnGroups).toHaveLength(2);
    expect(cfg.ticketColumns).toEqual(["month", "country", "ticket", "hours"]);
    expect(cfg.eurRate).toBe(24.2);
    expect(cfg.sheets).toEqual({ tickets: true, overview: true });
  });

  it("accepts null eurRate", () => {
    expect(parseExportPresetConfig({ ...valid(), eurRate: null }).eurRate).toBeNull();
  });

  it("rejects an empty columnGroups", () => {
    expect(() => parseExportPresetConfig({ ...valid(), columnGroups: [] })).toThrow(/columnGroups/);
  });

  it("rejects a duplicate group key", () => {
    const bad = valid();
    bad.columnGroups[1].key = "FR";
    expect(() => parseExportPresetConfig(bad)).toThrow(/Duplicate/);
  });

  it("rejects a project used in two groups", () => {
    const bad = valid();
    bad.columnGroups[1].projectIds = ["french_pimcore"];
    expect(() => parseExportPresetConfig(bad)).toThrow(/more than one group/);
  });

  it("rejects an unknown ticket column key", () => {
    expect(() => parseExportPresetConfig({ ...valid(), ticketColumns: ["month", "bogus"] })).toThrow(
      /valid column key/,
    );
  });

  it("rejects when no sheet is enabled", () => {
    expect(() =>
      parseExportPresetConfig({ ...valid(), sheets: { tickets: false, overview: false } }),
    ).toThrow(/At least one sheet/);
  });

  it("rejects a non-positive eurRate", () => {
    expect(() => parseExportPresetConfig({ ...valid(), eurRate: 0 })).toThrow(/eurRate/);
  });

  it("rejects a non-object input", () => {
    expect(() => parseExportPresetConfig(null)).toThrow(/must be an object/);
  });

  it("accepts valid columnHeaders", () => {
    const cfg = parseExportPresetConfig({ ...valid(), columnHeaders: { country: "Country", note: "Note" } });
    expect(cfg.columnHeaders).toEqual({ country: "Country", note: "Note" });
  });

  it("rejects columnHeaders that is an array", () => {
    expect(() => parseExportPresetConfig({ ...valid(), columnHeaders: [] })).toThrow(/columnHeaders must be an object/);
  });

  it("rejects a columnHeaders key that isn't a valid column", () => {
    expect(() => parseExportPresetConfig({ ...valid(), columnHeaders: { bogus: "x" } })).toThrow(/invalid key/);
  });

  it("rejects a non-string columnHeaders value", () => {
    expect(() => parseExportPresetConfig({ ...valid(), columnHeaders: { note: 5 } })).toThrow(/must be a string/);
  });
});
