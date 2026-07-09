import { describe, it, expect } from "vitest";
import {
  buildProjectTimeMatrix,
  UNASSIGNED_ID,
  type AnalyticsReportInput,
} from "./analytics";

function report(
  id: number,
  label: string,
  items: AnalyticsReportInput["items"],
): AnalyticsReportInput {
  return { id, label, items };
}

describe("buildProjectTimeMatrix", () => {
  it("assigns all minutes to a single-project item", () => {
    const m = buildProjectTimeMatrix([
      report(1, "2026-01", [
        { workedMinutes: 60, assignments: [{ projectId: "p1", project: { name: "Alpha" } }] },
      ]),
    ]);
    expect(m.minutes[1].p1).toBe(60);
    expect(m.projects).toEqual([{ id: "p1", name: "Alpha" }]);
    expect(m.reports).toEqual([{ id: 1, label: "2026-01" }]);
  });

  it("splits minutes evenly across multiple projects", () => {
    const m = buildProjectTimeMatrix([
      report(1, "2026-01", [
        {
          workedMinutes: 60,
          assignments: [
            { projectId: "p1", project: { name: "Alpha" } },
            { projectId: "p2", project: { name: "Beta" } },
          ],
        },
      ]),
    ]);
    expect(m.minutes[1].p1).toBe(30);
    expect(m.minutes[1].p2).toBe(30);
  });

  it("splits sum back to the item's total minutes (no double counting)", () => {
    const m = buildProjectTimeMatrix([
      report(1, "2026-01", [
        {
          workedMinutes: 100,
          assignments: [
            { projectId: "p1", project: { name: "Alpha" } },
            { projectId: "p2", project: { name: "Beta" } },
            { projectId: "p3", project: { name: "Gamma" } },
          ],
        },
      ]),
    ]);
    const sum = m.minutes[1].p1 + m.minutes[1].p2 + m.minutes[1].p3;
    expect(sum).toBeCloseTo(100, 10);
  });

  it("routes unassigned items to the Unassigned bucket", () => {
    const m = buildProjectTimeMatrix([
      report(1, "2026-01", [{ workedMinutes: 45, assignments: [] }]),
    ]);
    expect(m.minutes[1][UNASSIGNED_ID]).toBe(45);
    expect(m.projects).toEqual([{ id: UNASSIGNED_ID, name: "Unassigned" }]);
  });

  it("gives a zero-item report an empty column and no projects", () => {
    const m = buildProjectTimeMatrix([report(1, "2026-01", [])]);
    expect(m.minutes[1]).toEqual({});
    expect(m.projects).toEqual([]);
  });

  it("preserves each report's total minutes across projects", () => {
    const m = buildProjectTimeMatrix([
      report(1, "2026-01", [
        {
          workedMinutes: 60,
          assignments: [
            { projectId: "p1", project: { name: "Alpha" } },
            { projectId: "p2", project: { name: "Beta" } },
          ],
        },
        { workedMinutes: 30, assignments: [{ projectId: "p1", project: { name: "Alpha" } }] },
        { workedMinutes: 15, assignments: [] },
      ]),
    ]);
    const total = Object.values(m.minutes[1]).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(105, 10);
  });

  it("sorts real projects by name and puts Unassigned last", () => {
    const m = buildProjectTimeMatrix([
      report(1, "2026-01", [
        { workedMinutes: 10, assignments: [{ projectId: "pz", project: { name: "Zeta" } }] },
        { workedMinutes: 10, assignments: [{ projectId: "pa", project: { name: "Alpha" } }] },
        { workedMinutes: 10, assignments: [] },
      ]),
    ]);
    expect(m.projects.map((p) => p.name)).toEqual(["Alpha", "Zeta", "Unassigned"]);
  });

  it("keeps one row per report keyed by report id", () => {
    const m = buildProjectTimeMatrix([
      report(3, "2026-03", [{ workedMinutes: 20, assignments: [{ projectId: "p1", project: { name: "Alpha" } }] }]),
      report(2, "2026-02", []),
    ]);
    expect(Object.keys(m.minutes).sort()).toEqual(["2", "3"]);
    expect(m.reports).toEqual([
      { id: 3, label: "2026-03" },
      { id: 2, label: "2026-02" },
    ]);
  });
});
