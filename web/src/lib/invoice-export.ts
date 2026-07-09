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
  | "estimate";

export interface ColumnGroup {
  key: string;
  label: string;
  projectIds: string[];
}

export interface ExportPresetConfig {
  columnGroups: ColumnGroup[];
  ticketColumns: TicketColumnKey[];
  columnHeaders?: Partial<Record<TicketColumnKey, string>>;
  sheets: { tickets: boolean; overview: boolean };
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

  const groupMinutes = new Map<string, number>();
  for (const g of preset.columnGroups) groupMinutes.set(g.key, 0);

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

    // Sum this item's shares per group (several assigned projects can map to
    // the same group -> a single row).
    const perGroupForItem = new Map<string, number>();
    for (const pid of assigned) {
      const g = groupByProject.get(pid);
      if (!g) {
        excludedMinutes += share;
        continue;
      }
      perGroupForItem.set(g.key, (perGroupForItem.get(g.key) ?? 0) + share);
    }

    const isPm = it.jiraKey === null;
    for (const g of preset.columnGroups) {
      const mins = perGroupForItem.get(g.key);
      if (mins == null || mins === 0) continue;
      groupMinutes.set(g.key, (groupMinutes.get(g.key) ?? 0) + mins);
      ticketRows.push({
        groupKey: g.key,
        groupLabel: g.label,
        month: monthNumber,
        ticketLabel: isPm ? "PM" : it.jiraKey!,
        jiraUrl: isPm ? null : jiraUrl(input.jiraBaseUrl, it.jiraKey!),
        description: isPm ? "" : it.summary,
        hours: mins / 60,
        note: isPm ? it.summary : (it.reviewerComment ?? it.portaNotes ?? ""),
        status: it.jiraStatus,
        parent: it.parentKey,
        estimateHours:
          it.estimatedSeconds == null ? null : it.estimatedSeconds / 3600,
        sortMinutes: it.workedMinutes,
      });
    }
  }

  // Order: configured group order, then worked time desc within a group.
  const groupOrder = new Map(preset.columnGroups.map((g, i) => [g.key, i]));
  ticketRows.sort((a, b) => {
    const ga = groupOrder.get(a.groupKey) ?? 0;
    const gb = groupOrder.get(b.groupKey) ?? 0;
    if (ga !== gb) return ga - gb;
    return b.sortMinutes - a.sortMinutes;
  });

  const groups: ExportOverviewGroup[] = preset.columnGroups.map((g) => {
    const mins = groupMinutes.get(g.key) ?? 0;
    return {
      key: g.key,
      label: g.label,
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
