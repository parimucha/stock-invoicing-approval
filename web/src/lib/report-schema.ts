export type UploadItem = {
  source: "jira" | "project_management";
  jira_key: string | null;
  summary: string;
  worked_minutes: number;
  total_worked_minutes: number | null;
  estimated_seconds: number | null;
  jira_issuetype: string | null;
  jira_status: string | null;
  jira_labels: string[];
  parent_key: string | null;
  parent_summary: string | null;
  pm_notes: string | null;
  suggested_projects: string[];
};

export type UploadReport = {
  label: string;
  period_start: string;
  period_end: string;
  productive_deal_id: string | null;
  productive_budget_name: string | null;
  items: UploadItem[];
};

export function parseUploadReport(input: unknown): UploadReport {
  if (!input || typeof input !== "object") throw new Error("Report JSON must be an object.");
  const r = input as Record<string, unknown>;

  const str = (k: string, opt = false): string | null => {
    const v = r[k];
    if (v === undefined || v === null || v === "") {
      if (opt) return null;
      throw new Error(`Missing field: ${k}`);
    }
    if (typeof v !== "string") throw new Error(`Field ${k} must be a string.`);
    return v;
  };

  const label = str("label") as string;
  const period_start = str("period_start") as string;
  const period_end = str("period_end") as string;
  const productive_deal_id = str("productive_deal_id", true);
  const productive_budget_name = str("productive_budget_name", true);

  if (!/^\d{4}-\d{2}$/.test(label)) {
    throw new Error("label must be YYYY-MM (e.g. 2026-03).");
  }
  for (const [k, v] of [
    ["period_start", period_start],
    ["period_end", period_end],
  ] as const) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${k} must be YYYY-MM-DD.`);
  }

  if (!Array.isArray(r.items)) throw new Error("items must be an array.");
  const items: UploadItem[] = r.items.map((raw, i) => {
    if (!raw || typeof raw !== "object") throw new Error(`Item ${i} is not an object.`);
    const it = raw as Record<string, unknown>;
    const source = it.source;
    if (source !== "jira" && source !== "project_management") {
      throw new Error(`Item ${i} has invalid source: ${String(source)}.`);
    }
    if (typeof it.summary !== "string" || !it.summary) {
      throw new Error(`Item ${i} missing summary.`);
    }
    if (typeof it.worked_minutes !== "number" || it.worked_minutes < 0) {
      throw new Error(`Item ${i} has invalid worked_minutes.`);
    }
    if (!Array.isArray(it.jira_labels)) {
      throw new Error(`Item ${i} jira_labels must be an array.`);
    }
    if (!Array.isArray(it.suggested_projects)) {
      throw new Error(`Item ${i} suggested_projects must be an array.`);
    }
    return {
      source,
      jira_key: typeof it.jira_key === "string" ? it.jira_key : null,
      summary: it.summary,
      worked_minutes: it.worked_minutes,
      total_worked_minutes:
        typeof it.total_worked_minutes === "number" && it.total_worked_minutes >= 0
          ? it.total_worked_minutes
          : null,
      estimated_seconds:
        typeof it.estimated_seconds === "number" ? it.estimated_seconds : null,
      jira_issuetype: typeof it.jira_issuetype === "string" ? it.jira_issuetype : null,
      jira_status: typeof it.jira_status === "string" ? it.jira_status : null,
      jira_labels: it.jira_labels.filter((x): x is string => typeof x === "string"),
      parent_key: typeof it.parent_key === "string" ? it.parent_key : null,
      parent_summary: typeof it.parent_summary === "string" ? it.parent_summary : null,
      pm_notes: typeof it.pm_notes === "string" ? it.pm_notes : null,
      suggested_projects: it.suggested_projects.filter(
        (x): x is string => typeof x === "string",
      ),
    };
  });

  return {
    label,
    period_start,
    period_end,
    productive_deal_id,
    productive_budget_name,
    items,
  };
}
