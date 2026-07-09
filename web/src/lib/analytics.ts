// Pure attribution helper: turns report/item/assignment data into a
// per-report × per-project minute matrix for the analytics dashboard.
// No React, no Prisma — unit-testable in isolation.

export const UNASSIGNED_ID = "__unassigned__";
export const UNASSIGNED_NAME = "Unassigned";

export type AnalyticsItem = {
  workedMinutes: number;
  assignments: { projectId: string; project: { name: string } }[];
};

export type AnalyticsReportInput = {
  id: number;
  label: string;
  items: AnalyticsItem[];
};

export type AnalyticsProject = { id: string; name: string };

export type AnalyticsMatrix = {
  /** Reports in the order given (caller sorts chronologically). */
  reports: { id: number; label: string }[];
  /** Real projects sorted by name, then Unassigned last (only if it has minutes). */
  projects: AnalyticsProject[];
  /** minutes[reportId][projectId] — attributed minutes (float; round at display). */
  minutes: Record<number, Record<string, number>>;
};

export function buildProjectTimeMatrix(
  reports: AnalyticsReportInput[],
): AnalyticsMatrix {
  const minutes: Record<number, Record<string, number>> = {};
  const projectNames = new Map<string, string>();
  let unassignedTotal = 0;

  for (const report of reports) {
    const row: Record<string, number> = {};
    for (const item of report.items) {
      if (item.assignments.length === 0) {
        row[UNASSIGNED_ID] = (row[UNASSIGNED_ID] ?? 0) + item.workedMinutes;
        unassignedTotal += item.workedMinutes;
        continue;
      }
      const share = item.workedMinutes / item.assignments.length;
      for (const a of item.assignments) {
        row[a.projectId] = (row[a.projectId] ?? 0) + share;
        projectNames.set(a.projectId, a.project.name);
      }
    }
    minutes[report.id] = row;
  }

  const projects: AnalyticsProject[] = [...projectNames.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (unassignedTotal > 0) {
    projects.push({ id: UNASSIGNED_ID, name: UNASSIGNED_NAME });
  }

  return {
    reports: reports.map((r) => ({ id: r.id, label: r.label })),
    projects,
    minutes,
  };
}
