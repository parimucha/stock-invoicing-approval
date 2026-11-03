import { describe, it, expect } from "vitest";
import {
  computeExportModel,
  toExportInput,
  DEFAULT_PRESET,
  type ExportInput,
  type ExportItem,
  type ExportPresetConfig,
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

describe("computeExportModel grouped by epic", () => {
  const byEpic: ExportPresetConfig = { ...DEFAULT_PRESET, groupBy: "epic", columnGroups: [] };

  it("groups rows by parent epic, biggest first, with no-parent and PM items last", () => {
    const model = computeExportModel(
      input([
        item({ jiraKey: "A", workedMinutes: 60, parentKey: "PCM2-92", parentSummary: "PIM FR" }),
        item({ jiraKey: "B", workedMinutes: 180, parentKey: "PCM2-229", parentSummary: "PIM GER " }),
        item({ jiraKey: "C", workedMinutes: 30, parentKey: "PCM2-92", parentSummary: "PIM FR" }),
        item({ jiraKey: null, summary: "Weekly call", workedMinutes: 600 }),
        item({ jiraKey: "D", workedMinutes: 15 }),
      ]),
      byEpic,
    );
    expect(model.overview.groups.map((g) => [g.label, g.hours])).toEqual([
      ["PCM2-229 PIM GER", 3],
      ["PCM2-92 PIM FR", 1.5],
      ["No epic", 10.25],
    ]);
    expect(model.ticketRows.map((r) => r.ticketLabel)).toEqual(["B", "A", "C", "PM", "D"]);
    expect(model.ticketRows[0].epic).toBe("PCM2-229 PIM GER");
    expect(model.ticketRows[3].epic).toBeNull();
    expect(model.overview.totalHours).toBe(14.75);
    expect(model.excludedHours).toBe(0);
  });

  it("counts every project when there are no project groups, and a split item once", () => {
    const model = computeExportModel(
      input([
        item({
          workedMinutes: 120,
          parentKey: "PCM2-93",
          assignedProjectIds: ["czech_pimcore", "slovak_pimcore"],
        }),
      ]),
      byEpic,
    );
    expect(model.ticketRows).toHaveLength(1);
    expect(model.ticketRows[0].hours).toBe(2);
  });

  it("uses project groups as a filter and excludes shares outside them", () => {
    const model = computeExportModel(
      input([
        item({
          workedMinutes: 120,
          parentKey: "PCM2-93",
          assignedProjectIds: ["french_pimcore", "czech_pimcore"],
        }),
        item({ workedMinutes: 60, assignedProjectIds: [] }),
      ]),
      { ...DEFAULT_PRESET, groupBy: "epic" },
    );
    expect(model.ticketRows).toHaveLength(1);
    expect(model.ticketRows[0].hours).toBe(1);
    expect(model.excludedHours).toBe(2);
  });
});

describe("toExportInput", () => {
  it("maps a loaded report row into ExportInput with flattened assignedProjectIds", () => {
    const input = toExportInput(
      {
        label: "2026-05",
        periodStart: new Date("2026-05-01T00:00:00.000Z"),
        hourlyRateCzk: 1500,
        items: [
          {
            jiraKey: "PCM2-1",
            summary: "s",
            workedMinutes: 60,
            estimatedSeconds: null,
            jiraStatus: "Done",
            parentKey: null,
            parentSummary: null,
            portaNotes: null,
            reviewerComment: null,
            approval: "approved",
            assignments: [{ projectId: "french_pimcore" }, { projectId: "sap_spirit_fr" }],
          },
        ],
      },
      "https://x.atlassian.net",
    );
    expect(input.report.hourlyRateCzk).toBe(1500);
    expect(input.jiraBaseUrl).toBe("https://x.atlassian.net");
    expect(input.items[0].assignedProjectIds).toEqual(["french_pimcore", "sap_spirit_fr"]);
  });
});
