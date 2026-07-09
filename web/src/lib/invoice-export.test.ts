import { describe, it, expect } from "vitest";
import {
  computeExportModel,
  DEFAULT_PRESET,
  type ExportInput,
  type ExportItem,
} from "./invoice-export";

function item(partial: Partial<ExportItem>): ExportItem {
  return {
    jiraKey: "PCM2-1",
    summary: "A ticket",
    workedMinutes: 60,
    estimatedSeconds: null,
    jiraStatus: null,
    parentKey: null,
    parentSummary: null,
    portaNotes: null,
    reviewerComment: null,
    approval: "approved",
    assignedProjectIds: ["french_pimcore"],
    ...partial,
  };
}

function input(items: ExportItem[], hourlyRateCzk: number | null = 1000): ExportInput {
  return {
    report: {
      label: "2026-05",
      periodStart: new Date("2026-05-01T00:00:00.000Z"),
      hourlyRateCzk,
    },
    items,
    jiraBaseUrl: "https://stockspirits.atlassian.net",
  };
}

describe("computeExportModel", () => {
  it("derives the month number from periodStart (UTC)", () => {
    const model = computeExportModel(input([]), DEFAULT_PRESET);
    expect(model.monthNumber).toBe(5);
  });

  it("splits a shared ticket evenly into one row per group", () => {
    const model = computeExportModel(
      input([
        item({
          jiraKey: "PCM2-187",
          summary: "PIMCore models",
          workedMinutes: 120,
          assignedProjectIds: ["french_pimcore", "german_pimcore"],
        }),
      ]),
      DEFAULT_PRESET,
    );
    const fr = model.ticketRows.find((r) => r.groupKey === "FR" && r.ticketLabel === "PCM2-187");
    const ger = model.ticketRows.find((r) => r.groupKey === "GER" && r.ticketLabel === "PCM2-187");
    expect(fr?.hours).toBe(1);
    expect(ger?.hours).toBe(1);
    expect(fr?.jiraUrl).toBe("https://stockspirits.atlassian.net/browse/PCM2-187");
    expect(fr?.description).toBe("PIMCore models");
  });

  it("sums shares into a single row when two assigned projects map to the same group", () => {
    const model = computeExportModel(
      input([
        item({
          jiraKey: "SAPS-9",
          workedMinutes: 120,
          assignedProjectIds: ["french_pimcore", "sap_spirit_fr"],
        }),
      ]),
      DEFAULT_PRESET,
    );
    const frRows = model.ticketRows.filter((r) => r.groupKey === "FR");
    expect(frRows).toHaveLength(1);
    expect(frRows[0].hours).toBe(2); // 60 + 60 minutes -> 2h, one row
  });

  it("renders a PM row with 'PM' label, no url, and the summary as the note", () => {
    const model = computeExportModel(
      input([
        item({
          jiraKey: null,
          summary: "Weekly status",
          workedMinutes: 69,
          assignedProjectIds: ["french_pimcore"],
        }),
      ]),
      DEFAULT_PRESET,
    );
    const row = model.ticketRows[0];
    expect(row.ticketLabel).toBe("PM");
    expect(row.jiraUrl).toBeNull();
    expect(row.description).toBe("");
    expect(row.note).toBe("Weekly status");
    expect(row.hours).toBeCloseTo(1.15);
  });

  it("prefers reviewerComment over portaNotes for a JIRA row note", () => {
    const withComment = computeExportModel(
      input([item({ reviewerComment: "rc", portaNotes: "pn" })]),
      DEFAULT_PRESET,
    );
    expect(withComment.ticketRows[0].note).toBe("rc");
    const withPortaOnly = computeExportModel(
      input([item({ reviewerComment: null, portaNotes: "pn" })]),
      DEFAULT_PRESET,
    );
    expect(withPortaOnly.ticketRows[0].note).toBe("pn");
  });

  it("excludes unapproved items and counts unassigned/ungrouped hours as excluded", () => {
    const model = computeExportModel(
      input([
        item({ jiraKey: "P-approved", workedMinutes: 60, assignedProjectIds: ["french_pimcore"] }),
        item({ jiraKey: "P-pending", approval: "pending", workedMinutes: 600, assignedProjectIds: ["french_pimcore"] }),
        item({ jiraKey: "P-unassigned", workedMinutes: 60, assignedProjectIds: [] }),
        item({ jiraKey: "P-othergroup", workedMinutes: 120, assignedProjectIds: ["czech_pimcore"] }),
      ]),
      DEFAULT_PRESET,
    );
    expect(model.ticketRows.map((r) => r.ticketLabel)).toEqual(["P-approved"]);
    expect(model.excludedHours).toBe(3); // 1h unassigned + 2h ungrouped
  });

  it("computes per-group and total hours and CZK", () => {
    const model = computeExportModel(
      input(
        [
          item({ jiraKey: "A", workedMinutes: 420, assignedProjectIds: ["sap_spirit_fr"] }),
          item({ jiraKey: "B", workedMinutes: 60, assignedProjectIds: ["german_pimcore"] }),
        ],
        1000,
      ),
      DEFAULT_PRESET,
    );
    const fr = model.overview.groups.find((g) => g.key === "FR")!;
    const ger = model.overview.groups.find((g) => g.key === "GER")!;
    expect(fr.hours).toBe(7);
    expect(fr.czk).toBe(7000);
    expect(ger.hours).toBe(1);
    expect(ger.czk).toBe(1000);
    expect(model.overview.totalHours).toBe(8);
    expect(model.overview.totalCzk).toBe(8000);
    expect(model.overview.eurRate).toBe(24.2);
  });

  it("sets CZK to null when the report has no hourly rate", () => {
    const model = computeExportModel(
      input([item({ workedMinutes: 60 })], null),
      DEFAULT_PRESET,
    );
    expect(model.overview.groups[0].czk).toBeNull();
    expect(model.overview.totalCzk).toBeNull();
  });
});
