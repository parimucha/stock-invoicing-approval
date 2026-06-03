// Self-contained report backup format. No imports from Prisma or Next so this
// module stays purely unit-testable. The download route and restore action map
// Prisma rows to/from these shapes.

export const CURRENT_SCHEMA_VERSION = 1;

export type Approval = "pending" | "approved" | "rejected";
export type ItemSource = "jira" | "project_management";
export type ReportStatus =
  | "draft"
  | "sent"
  | "under_review"
  | "approved"
  | "rejected";

// ---- serializeBackup input (matches a Prisma report loaded with
// items -> assignments, plus the referenced projects) ----

export interface SerializeProject {
  id: string;
  name: string;
  sortOrder: number;
}

export interface SerializeAssignment {
  projectId: string;
}

export interface SerializeItem {
  source: ItemSource;
  jiraKey: string | null;
  summary: string;
  workedMinutes: number;
  totalWorkedMinutes: number | null;
  estimatedSeconds: number | null;
  jiraIssuetype: string | null;
  jiraStatus: string | null;
  jiraLabels: unknown; // Prisma Json column
  parentKey: string | null;
  parentSummary: string | null;
  pmNotes: string | null;
  portaNotes: string | null;
  internal: boolean;
  suggestedProjects: unknown; // Prisma Json column
  approval: Approval;
  reviewerComment: string | null;
  assignments: SerializeAssignment[];
}

export interface SerializeReport {
  id: number;
  label: string;
  periodStart: Date;
  periodEnd: Date;
  productiveDealId: string | null;
  productiveBudgetName: string | null;
  hourlyRateCzk: number | null;
  status: ReportStatus;
  magicToken: string;
  reviewerNote: string | null;
  createdAt: Date;
  sentAt: Date | null;
  reviewedAt: Date | null;
  items: SerializeItem[];
}

export interface SerializeInput {
  report: SerializeReport;
  projects: SerializeProject[];
}

// ---- backup file shape (what gets written to disk / validated on read) ----

export interface BackupProject {
  id: string;
  name: string;
  sortOrder: number;
}

export interface BackupItem {
  source: ItemSource;
  jiraKey: string | null;
  summary: string;
  workedMinutes: number;
  totalWorkedMinutes: number | null;
  estimatedSeconds: number | null;
  jiraIssuetype: string | null;
  jiraStatus: string | null;
  jiraLabels: string[];
  parentKey: string | null;
  parentSummary: string | null;
  pmNotes: string | null;
  portaNotes: string | null;
  internal: boolean;
  suggestedProjects: string[];
  approval: Approval;
  reviewerComment: string | null;
  assignedProjects: string[];
}

export interface BackupReport {
  id: number;
  label: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  productiveDealId: string | null;
  productiveBudgetName: string | null;
  hourlyRateCzk: number | null;
  status: ReportStatus;
  magicToken: string;
  reviewerNote: string | null;
  createdAt: string; // ISO datetime
  sentAt: string | null;
  reviewedAt: string | null;
  items: BackupItem[];
}

export interface Backup {
  schemaVersion: number;
  exportedAt: string;
  report: BackupReport;
  projects: BackupProject[];
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toIso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function serializeBackup(input: SerializeInput, exportedAt: string): Backup {
  const { report, projects } = input;
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt,
    report: {
      id: report.id,
      label: report.label,
      periodStart: toDateString(report.periodStart),
      periodEnd: toDateString(report.periodEnd),
      productiveDealId: report.productiveDealId,
      productiveBudgetName: report.productiveBudgetName,
      hourlyRateCzk: report.hourlyRateCzk,
      status: report.status,
      magicToken: report.magicToken,
      reviewerNote: report.reviewerNote,
      createdAt: report.createdAt.toISOString(),
      sentAt: toIso(report.sentAt),
      reviewedAt: toIso(report.reviewedAt),
      items: report.items.map((it) => ({
        source: it.source,
        jiraKey: it.jiraKey,
        summary: it.summary,
        workedMinutes: it.workedMinutes,
        totalWorkedMinutes: it.totalWorkedMinutes,
        estimatedSeconds: it.estimatedSeconds,
        jiraIssuetype: it.jiraIssuetype,
        jiraStatus: it.jiraStatus,
        jiraLabels: asStringArray(it.jiraLabels),
        parentKey: it.parentKey,
        parentSummary: it.parentSummary,
        pmNotes: it.pmNotes,
        portaNotes: it.portaNotes,
        internal: it.internal,
        suggestedProjects: asStringArray(it.suggestedProjects),
        approval: it.approval,
        reviewerComment: it.reviewerComment,
        assignedProjects: it.assignments.map((a) => a.projectId),
      })),
    },
    projects: projects.map((p) => ({ id: p.id, name: p.name, sortOrder: p.sortOrder })),
  };
}
