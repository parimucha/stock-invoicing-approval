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

export type ParsedBackup = Backup;

const REPORT_STATUSES: ReportStatus[] = [
  "draft",
  "sent",
  "under_review",
  "approved",
  "rejected",
];

export function parseBackup(input: unknown): ParsedBackup {
  if (!input || typeof input !== "object") {
    throw new Error("Backup must be a JSON object.");
  }
  const root = input as Record<string, unknown>;

  if (root.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported schemaVersion: ${String(root.schemaVersion)} (expected ${CURRENT_SCHEMA_VERSION}).`,
    );
  }
  if (typeof root.exportedAt !== "string") {
    throw new Error("Missing field: exportedAt.");
  }

  const rRaw = root.report;
  if (!rRaw || typeof rRaw !== "object") {
    throw new Error("Backup is missing the report object.");
  }
  const rep = rRaw as Record<string, unknown>;

  const reqStr = (k: string): string => {
    const v = rep[k];
    if (typeof v !== "string" || v === "") throw new Error(`Missing field: report.${k}`);
    return v;
  };
  const optStr = (k: string): string | null => {
    const v = rep[k];
    if (v === undefined || v === null) return null;
    if (typeof v !== "string") throw new Error(`Field report.${k} must be a string or null.`);
    return v;
  };
  const optInt = (k: string): number | null => {
    const v = rep[k];
    if (v === undefined || v === null) return null;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`Field report.${k} must be a number or null.`);
    }
    return v;
  };
  const isoOrNull = (k: string): string | null => {
    const v = rep[k];
    if (v === undefined || v === null) return null;
    if (typeof v !== "string" || Number.isNaN(Date.parse(v))) {
      throw new Error(`report.${k} must be an ISO datetime or null.`);
    }
    return v;
  };

  if (typeof rep.id !== "number" || !Number.isInteger(rep.id)) {
    throw new Error("report.id must be an integer.");
  }
  const label = reqStr("label");
  const periodStart = reqStr("periodStart");
  const periodEnd = reqStr("periodEnd");
  for (const [k, v] of [
    ["periodStart", periodStart],
    ["periodEnd", periodEnd],
  ] as const) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`report.${k} must be YYYY-MM-DD.`);
  }
  const status = reqStr("status");
  if (!REPORT_STATUSES.includes(status as ReportStatus)) {
    throw new Error(`Invalid report.status: ${status}.`);
  }
  const magicToken = reqStr("magicToken");
  const createdAt = rep.createdAt;
  if (typeof createdAt !== "string" || Number.isNaN(Date.parse(createdAt))) {
    throw new Error("report.createdAt must be an ISO datetime.");
  }

  if (!Array.isArray(rep.items)) throw new Error("report.items must be an array.");
  const items: BackupItem[] = rep.items.map((raw, i) => {
    if (!raw || typeof raw !== "object") throw new Error(`Item ${i} is not an object.`);
    const it = raw as Record<string, unknown>;
    if (it.source !== "jira" && it.source !== "project_management") {
      throw new Error(`Item ${i} has invalid source: ${String(it.source)}.`);
    }
    if (typeof it.summary !== "string" || !it.summary) {
      throw new Error(`Item ${i} missing summary.`);
    }
    if (typeof it.workedMinutes !== "number" || it.workedMinutes < 0) {
      throw new Error(`Item ${i} has invalid workedMinutes.`);
    }
    if (it.approval !== "pending" && it.approval !== "approved" && it.approval !== "rejected") {
      throw new Error(`Item ${i} has invalid approval: ${String(it.approval)}.`);
    }
    if (typeof it.internal !== "boolean") {
      throw new Error(`Item ${i} internal must be a boolean.`);
    }
    if (!Array.isArray(it.jiraLabels)) throw new Error(`Item ${i} jiraLabels must be an array.`);
    if (!Array.isArray(it.suggestedProjects)) {
      throw new Error(`Item ${i} suggestedProjects must be an array.`);
    }
    if (!Array.isArray(it.assignedProjects)) {
      throw new Error(`Item ${i} assignedProjects must be an array.`);
    }
    return {
      source: it.source,
      jiraKey: typeof it.jiraKey === "string" ? it.jiraKey : null,
      summary: it.summary,
      workedMinutes: it.workedMinutes,
      totalWorkedMinutes:
        typeof it.totalWorkedMinutes === "number" ? it.totalWorkedMinutes : null,
      estimatedSeconds: typeof it.estimatedSeconds === "number" ? it.estimatedSeconds : null,
      jiraIssuetype: typeof it.jiraIssuetype === "string" ? it.jiraIssuetype : null,
      jiraStatus: typeof it.jiraStatus === "string" ? it.jiraStatus : null,
      jiraLabels: it.jiraLabels.filter((x): x is string => typeof x === "string"),
      parentKey: typeof it.parentKey === "string" ? it.parentKey : null,
      parentSummary: typeof it.parentSummary === "string" ? it.parentSummary : null,
      pmNotes: typeof it.pmNotes === "string" ? it.pmNotes : null,
      portaNotes: typeof it.portaNotes === "string" ? it.portaNotes : null,
      internal: it.internal,
      suggestedProjects: it.suggestedProjects.filter((x): x is string => typeof x === "string"),
      approval: it.approval,
      reviewerComment: typeof it.reviewerComment === "string" ? it.reviewerComment : null,
      assignedProjects: it.assignedProjects.filter((x): x is string => typeof x === "string"),
    };
  });

  if (!Array.isArray(root.projects)) throw new Error("projects must be an array.");
  const projects: BackupProject[] = root.projects.map((raw, i) => {
    if (!raw || typeof raw !== "object") throw new Error(`Project ${i} is not an object.`);
    const p = raw as Record<string, unknown>;
    if (typeof p.id !== "string" || !p.id) throw new Error(`Project ${i} missing id.`);
    if (typeof p.name !== "string" || !p.name) throw new Error(`Project ${i} missing name.`);
    return { id: p.id, name: p.name, sortOrder: typeof p.sortOrder === "number" ? p.sortOrder : 0 };
  });

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: root.exportedAt,
    report: {
      id: rep.id,
      label,
      periodStart,
      periodEnd,
      productiveDealId: optStr("productiveDealId"),
      productiveBudgetName: optStr("productiveBudgetName"),
      hourlyRateCzk: optInt("hourlyRateCzk"),
      status: status as ReportStatus,
      magicToken,
      reviewerNote: optStr("reviewerNote"),
      createdAt,
      sentAt: isoOrNull("sentAt"),
      reviewedAt: isoOrNull("reviewedAt"),
      items,
    },
    projects,
  };
}
