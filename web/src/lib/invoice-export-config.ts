// Hand-rolled validation for an ExportPreset's stored `config` JSON, in the
// style of report-schema.ts (the repo has no zod). Used on every preset save
// and on every preset load in the download route.

import type {
  ColumnGroup,
  ExportPresetConfig,
  TicketColumnKey,
} from "./invoice-export";

const TICKET_COLUMN_KEYS: TicketColumnKey[] = [
  "month",
  "country",
  "ticket",
  "description",
  "hours",
  "note",
  "status",
  "parent",
  "estimate",
];

export function parseExportPresetConfig(input: unknown): ExportPresetConfig {
  if (!input || typeof input !== "object") {
    throw new Error("Preset config must be an object.");
  }
  const r = input as Record<string, unknown>;

  // ---- columnGroups ----
  if (!Array.isArray(r.columnGroups) || r.columnGroups.length === 0) {
    throw new Error("columnGroups must be a non-empty array.");
  }
  const seenKeys = new Set<string>();
  const columnGroups: ColumnGroup[] = r.columnGroups.map((g, i) => {
    if (!g || typeof g !== "object") {
      throw new Error(`columnGroups[${i}] must be an object.`);
    }
    const gg = g as Record<string, unknown>;
    if (typeof gg.key !== "string" || gg.key === "") {
      throw new Error(`columnGroups[${i}].key must be a non-empty string.`);
    }
    if (seenKeys.has(gg.key)) {
      throw new Error(`Duplicate columnGroups key: ${gg.key}`);
    }
    seenKeys.add(gg.key);
    if (typeof gg.label !== "string" || gg.label === "") {
      throw new Error(`columnGroups[${i}].label must be a non-empty string.`);
    }
    if (
      !Array.isArray(gg.projectIds) ||
      gg.projectIds.some((p) => typeof p !== "string")
    ) {
      throw new Error(`columnGroups[${i}].projectIds must be an array of strings.`);
    }
    return { key: gg.key, label: gg.label, projectIds: gg.projectIds as string[] };
  });

  // A project may appear in at most one group (rollup, not overlap).
  const seenProjects = new Set<string>();
  for (const g of columnGroups) {
    for (const pid of g.projectIds) {
      if (seenProjects.has(pid)) {
        throw new Error(`Project ${pid} is in more than one group.`);
      }
      seenProjects.add(pid);
    }
  }

  // ---- ticketColumns ----
  if (!Array.isArray(r.ticketColumns) || r.ticketColumns.length === 0) {
    throw new Error("ticketColumns must be a non-empty array.");
  }
  const ticketColumns = r.ticketColumns.map((c, i) => {
    if (typeof c !== "string" || !TICKET_COLUMN_KEYS.includes(c as TicketColumnKey)) {
      throw new Error(`ticketColumns[${i}] is not a valid column key: ${String(c)}`);
    }
    return c as TicketColumnKey;
  });

  // ---- columnHeaders (optional) ----
  let columnHeaders: Partial<Record<TicketColumnKey, string>> | undefined;
  if (r.columnHeaders !== undefined && r.columnHeaders !== null) {
    if (typeof r.columnHeaders !== "object" || Array.isArray(r.columnHeaders)) {
      throw new Error("columnHeaders must be an object.");
    }
    columnHeaders = {};
    for (const [k, v] of Object.entries(r.columnHeaders as Record<string, unknown>)) {
      if (!TICKET_COLUMN_KEYS.includes(k as TicketColumnKey)) {
        throw new Error(`columnHeaders has invalid key: ${k}`);
      }
      if (typeof v !== "string") {
        throw new Error(`columnHeaders.${k} must be a string.`);
      }
      columnHeaders[k as TicketColumnKey] = v;
    }
  }

  // ---- sheets ----
  if (!r.sheets || typeof r.sheets !== "object") {
    throw new Error("sheets must be an object.");
  }
  const s = r.sheets as Record<string, unknown>;
  if (typeof s.tickets !== "boolean" || typeof s.overview !== "boolean") {
    throw new Error("sheets.tickets and sheets.overview must be booleans.");
  }
  if (!s.tickets && !s.overview) {
    throw new Error("At least one sheet must be enabled.");
  }

  // ---- eurRate ----
  let eurRate: number | null;
  if (r.eurRate === null || r.eurRate === undefined) {
    eurRate = null;
  } else if (typeof r.eurRate === "number" && Number.isFinite(r.eurRate) && r.eurRate > 0) {
    eurRate = r.eurRate;
  } else {
    throw new Error("eurRate must be a positive number or null.");
  }

  return {
    columnGroups,
    ticketColumns,
    ...(columnHeaders ? { columnHeaders } : {}),
    sheets: { tickets: s.tickets, overview: s.overview },
    eurRate,
  };
}
