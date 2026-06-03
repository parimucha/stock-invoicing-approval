import { describe, it, expect } from "vitest";
import { serializeBackup, parseBackup, CURRENT_SCHEMA_VERSION, type SerializeInput } from "./report-backup";

function sampleInput(): SerializeInput {
  return {
    report: {
      id: 7,
      label: "2026-05",
      periodStart: new Date("2026-05-01T00:00:00.000Z"),
      periodEnd: new Date("2026-05-31T00:00:00.000Z"),
      productiveDealId: "3624023",
      productiveBudgetName: "stock.cz_design&development (2026/05)",
      hourlyRateCzk: 1500,
      status: "under_review",
      magicToken: "tok-abc",
      reviewerNote: "looks good",
      createdAt: new Date("2026-06-01T08:00:00.000Z"),
      sentAt: new Date("2026-06-01T09:00:00.000Z"),
      reviewedAt: null,
      items: [
        {
          source: "jira",
          jiraKey: "PCM2-123",
          summary: "Build the thing",
          workedMinutes: 120,
          totalWorkedMinutes: 480,
          estimatedSeconds: 3600,
          jiraIssuetype: "Task",
          jiraStatus: "Done",
          jiraLabels: ["frontend", "billable"],
          parentKey: "PCM2-100",
          parentSummary: "Epic",
          pmNotes: "pm note",
          portaNotes: "porta note",
          internal: false,
          suggestedProjects: ["czech_pimcore"],
          approval: "approved",
          reviewerComment: "ok",
          assignments: [{ projectId: "czech_pimcore" }, { projectId: "sap_spirit" }],
        },
      ],
    },
    projects: [
      { id: "czech_pimcore", name: "Czech Pimcore", sortOrder: 1 },
      { id: "sap_spirit", name: "SAP Spirit - general", sortOrder: 5 },
    ],
  };
}

describe("serializeBackup", () => {
  it("produces a complete envelope with ISO/date strings and resolved assignments", () => {
    const backup = serializeBackup(sampleInput(), "2026-06-03T12:00:00.000Z");

    expect(backup.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(backup.exportedAt).toBe("2026-06-03T12:00:00.000Z");
    expect(backup.report.id).toBe(7);
    expect(backup.report.periodStart).toBe("2026-05-01");
    expect(backup.report.periodEnd).toBe("2026-05-31");
    expect(backup.report.createdAt).toBe("2026-06-01T08:00:00.000Z");
    expect(backup.report.sentAt).toBe("2026-06-01T09:00:00.000Z");
    expect(backup.report.reviewedAt).toBeNull();
    expect(backup.report.magicToken).toBe("tok-abc");
    expect(backup.report.status).toBe("under_review");

    const item = backup.report.items[0];
    expect(item.portaNotes).toBe("porta note");
    expect(item.approval).toBe("approved");
    expect(item.reviewerComment).toBe("ok");
    expect(item.internal).toBe(false);
    expect(item.jiraLabels).toEqual(["frontend", "billable"]);
    expect(item.suggestedProjects).toEqual(["czech_pimcore"]);
    expect(item.assignedProjects).toEqual(["czech_pimcore", "sap_spirit"]);

    expect(backup.projects).toEqual([
      { id: "czech_pimcore", name: "Czech Pimcore", sortOrder: 1 },
      { id: "sap_spirit", name: "SAP Spirit - general", sortOrder: 5 },
    ]);
  });
});

describe("parseBackup", () => {
  it("round-trips a serialized backup unchanged", () => {
    const backup = serializeBackup(sampleInput(), "2026-06-03T12:00:00.000Z");
    expect(parseBackup(backup)).toEqual(backup);
  });

  it("rejects an unsupported schemaVersion", () => {
    const backup = serializeBackup(sampleInput(), "2026-06-03T12:00:00.000Z");
    expect(() => parseBackup({ ...backup, schemaVersion: 99 })).toThrow(/schemaVersion/);
  });

  it("rejects a missing report object", () => {
    expect(() => parseBackup({ schemaVersion: 1, exportedAt: "x", projects: [] })).toThrow(
      /report/,
    );
  });

  it("rejects a bad period format", () => {
    const backup = serializeBackup(sampleInput(), "2026-06-03T12:00:00.000Z");
    const bad = { ...backup, report: { ...backup.report, periodStart: "May 2026" } };
    expect(() => parseBackup(bad)).toThrow(/periodStart must be YYYY-MM-DD/);
  });

  it("rejects an invalid item approval value", () => {
    const backup = serializeBackup(sampleInput(), "2026-06-03T12:00:00.000Z");
    const items = [{ ...backup.report.items[0], approval: "maybe" }];
    const bad = { ...backup, report: { ...backup.report, items } };
    expect(() => parseBackup(bad)).toThrow(/approval/);
  });

  it("rejects when projects is not an array", () => {
    const backup = serializeBackup(sampleInput(), "2026-06-03T12:00:00.000Z");
    expect(() => parseBackup({ ...backup, projects: "nope" })).toThrow(/projects must be an array/);
  });
});
