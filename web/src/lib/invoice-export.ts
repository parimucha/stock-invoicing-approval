// Pure invoice-export engine. No imports from Prisma, Next, or exceljs so this
// module stays fast and trivially unit-testable (mirrors report-backup.ts).
// The download route maps Prisma rows into ExportInput; invoice-workbook.ts
// renders the returned ExportModel into an .xlsx.

export type TicketColumnKey =
  | "month"
  | "country"
  | "ticket"
  | "description"
  | "hours"
  | "note"
  | "status"
  | "parent"
  | "epic"
  | "estimate";

// "projects": rows/overview columns are the preset's project groups.
// "epic": rows/overview columns are the items' Jira parent (epic); project
// groups then only filter which projects count (empty = all projects).
export type ExportGroupBy = "projects" | "epic";

export interface ColumnGroup {
  key: string;
  label: string;
  projectIds: string[];
}

export interface ExportPresetConfig {
  groupBy?: ExportGroupBy; // absent = "projects"
  columnGroups: ColumnGroup[];
  ticketColumns: TicketColumnKey[];
  columnHeaders?: Partial<Record<TicketColumnKey, string>>;
  // perGroup: one tickets sheet per group instead of a single Tickets sheet.
  sheets: { tickets: boolean; overview: boolean; perGroup?: boolean };
  eurRate: number | null;
}

export interface ExportItem {
  jiraKey: string | null;
  summary: string;
  workedMinutes: number;
  estimatedSeconds: number | null;
  jiraStatus: string | null;
  parentKey: string | null;
  parentSummary: string | null;
  portaNotes: string | null;
  reviewerComment: string | null;
  approval: "pending" | "approved" | "rejected";
  assignedProjectIds: string[];
}

export interface ExportReport {
  label: string;
  periodStart: Date;
  hourlyRateCzk: number | null;
}

export interface ExportInput {
  report: ExportReport;
  items: ExportItem[];
  jiraBaseUrl: string | null;
}

export interface ExportTicketRow {
  groupKey: string;
  groupLabel: string;
  month: number;
  ticketLabel: string; // jiraKey, or "PM"
  jiraUrl: string | null; // hyperlink target; null for PM or when no base URL
  description: string;
  hours: number;
  note: string;
  status: string | null;
  parent: string | null;
  epic: string | null; // "PCM2-229 PIM GER", or null when the item has no parent
  estimateHours: number | null;
  sortMinutes: number; // item.workedMinutes, for ordering only
}

export interface ExportOverviewGroup {
  key: string;
  label: string;
  hours: number;
  czk: number | null;
}

export interface ExportOverview {
  groups: ExportOverviewGroup[];
  totalHours: number;
  totalCzk: number | null;
  eurRate: number | null;
}

export interface ExportModel {
  monthNumber: number;
  ticketRows: ExportTicketRow[];
  overview: ExportOverview;
  excludedHours: number;
}

export const DEFAULT_PRESET: ExportPresetConfig = {
  columnGroups: [
    { key: "FR", label: "FR", projectIds: ["french_pimcore", "sap_spirit_fr"] },
    { key: "GER", label: "GER", projectIds: ["german_pimcore", "sap_spirit_de"] },
  ],
  ticketColumns: ["month", "country", "ticket", "description", "hours", "note"],
  sheets: { tickets: true, overview: true },
  eurRate: 24.2,
};

export const NO_EPIC_KEY = "__no_epic__";
export const NO_EPIC_LABEL = "No epic";

function epicLabel(it: ExportItem): string | null {
  if (!it.parentKey) return null;
  return `${it.parentKey} ${it.parentSummary ?? ""}`.trim();
}

function jiraUrl(base: string | null, key: string): string | null {
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/browse/${key}`;
}

export function computeExportModel(
  input: ExportInput,
  preset: ExportPresetConfig,
): ExportModel {
  const monthNumber = input.report.periodStart.getUTCMonth() + 1;
  const rate = input.report.hourlyRateCzk;

  // projectId -> group; first group that lists the project wins.
  const groupByProject = new Map<string, ColumnGroup>();
  for (const g of preset.columnGroups) {
    for (const pid of g.projectIds) {
      if (!groupByProject.has(pid)) groupByProject.set(pid, g);
    }
  }

  const byEpic = preset.groupBy === "epic";
  const allProjects = byEpic && preset.columnGroups.length === 0;

  // Insertion order is the column order in "projects" mode; epic mode
  // re-sorts below once totals are known.
  const groupMinutes = new Map<string, number>();
  const groupLabels = new Map<string, string>();
  if (!byEpic) {
    for (const g of preset.columnGroups) {
      groupMinutes.set(g.key, 0);
      groupLabels.set(g.key, g.label);
    }
  }

  const ticketRows: ExportTicketRow[] = [];
  let excludedMinutes = 0;

  for (const it of input.items) {
    if (it.approval !== "approved") continue;
    const assigned = it.assignedProjectIds;
    if (assigned.length === 0) {
      excludedMinutes += it.workedMinutes;
      continue;
    }
    const share = it.workedMinutes / assigned.length;
    const epic = epicLabel(it);

    // Sum this item's shares per group (several assigned projects can map to
    // the same group -> a single row; in epic mode every share lands in the
    // item's one epic group).
    const perGroupForItem = new Map<string, number>();
    for (const pid of assigned) {
      const g = groupByProject.get(pid);
      if (!g && !allProjects) {
        excludedMinutes += share;
        continue;
      }
      const key = byEpic ? (it.parentKey ?? NO_EPIC_KEY) : g!.key;
      if (!groupLabels.has(key)) {
        groupLabels.set(key, byEpic ? (epic ?? NO_EPIC_LABEL) : g!.label);
      }
      perGroupForItem.set(key, (perGroupForItem.get(key) ?? 0) + share);
    }

    const isPm = it.jiraKey === null;
    for (const [key, mins] of perGroupForItem) {
      if (mins === 0) continue;
      groupMinutes.set(key, (groupMinutes.get(key) ?? 0) + mins);
      ticketRows.push({
        groupKey: key,
        groupLabel: groupLabels.get(key)!,
        month: monthNumber,
        ticketLabel: isPm ? "PM" : it.jiraKey!,
        jiraUrl: isPm ? null : jiraUrl(input.jiraBaseUrl, it.jiraKey!),
        description: isPm ? "" : it.summary,
        hours: mins / 60,
        note: isPm ? it.summary : (it.reviewerComment ?? it.portaNotes ?? ""),
        status: it.jiraStatus,
        parent: it.parentKey,
        epic,
        estimateHours:
          it.estimatedSeconds == null ? null : it.estimatedSeconds / 3600,
        sortMinutes: it.workedMinutes,
      });
    }
  }

  // Epic mode: biggest epic first, "No epic" always last.
  const groupKeys = [...groupMinutes.keys()];
  if (byEpic) {
    groupKeys.sort((a, b) => {
      if (a === NO_EPIC_KEY) return 1;
      if (b === NO_EPIC_KEY) return -1;
      return groupMinutes.get(b)! - groupMinutes.get(a)!;
    });
  }

  // Order: group order, then worked time desc within a group.
  const groupOrder = new Map(groupKeys.map((k, i) => [k, i]));
  ticketRows.sort((a, b) => {
    const ga = groupOrder.get(a.groupKey) ?? 0;
    const gb = groupOrder.get(b.groupKey) ?? 0;
    if (ga !== gb) return ga - gb;
    return b.sortMinutes - a.sortMinutes;
  });

  const groups: ExportOverviewGroup[] = groupKeys.map((key) => {
    const mins = groupMinutes.get(key) ?? 0;
    return {
      key,
      label: groupLabels.get(key)!,
      hours: mins / 60,
      czk: rate == null ? null : Math.ceil((mins / 60) * rate),
    };
  });
  const totalHours = groups.reduce((s, g) => s + g.hours, 0);
  const totalCzk =
    rate == null ? null : groups.reduce((s, g) => s + (g.czk ?? 0), 0);

  return {
    monthNumber,
    ticketRows,
    overview: { groups, totalHours, totalCzk, eurRate: preset.eurRate },
    excludedHours: excludedMinutes / 60,
  };
}

// ---- Prisma-row -> ExportInput adapter. Structural types so this stays
// framework-free; a Prisma report loaded with items+assignments satisfies them.

export interface RawItem {
  jiraKey: string | null;
  summary: string;
  workedMinutes: number;
  estimatedSeconds: number | null;
  jiraStatus: string | null;
  parentKey: string | null;
  parentSummary: string | null;
  portaNotes: string | null;
  reviewerComment: string | null;
  approval: "pending" | "approved" | "rejected";
  assignments: { projectId: string }[];
}

export interface RawReport {
  label: string;
  periodStart: Date;
  hourlyRateCzk: number | null;
  items: RawItem[];
}

export function toExportInput(
  report: RawReport,
  jiraBaseUrl: string | null,
): ExportInput {
  return {
    report: {
      label: report.label,
      periodStart: report.periodStart,
      hourlyRateCzk: report.hourlyRateCzk,
    },
    items: report.items.map((it) => ({
      jiraKey: it.jiraKey,
      summary: it.summary,
      workedMinutes: it.workedMinutes,
      estimatedSeconds: it.estimatedSeconds,
      jiraStatus: it.jiraStatus,
      parentKey: it.parentKey,
      parentSummary: it.parentSummary,
      portaNotes: it.portaNotes,
      reviewerComment: it.reviewerComment,
      approval: it.approval,
      assignedProjectIds: it.assignments.map((a) => a.projectId),
    })),
    jiraBaseUrl,
  };
}
