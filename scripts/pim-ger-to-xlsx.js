#!/usr/bin/env node
/**
 * Build an Excel workbook from data/pim-ger/pim-ger-report.json.
 *
 * Sheets:
 *   Summary      — headline totals + estimate-vs-logged
 *   Per task     — JIRA tickets + unlinked Productive sections, with estimate
 *   Per person   — combined totals across both buckets
 *   Pivot        — person × task hours grid
 *   All entries  — flat per-entry table (both buckets, with source flag)
 *
 * Usage: node scripts/pim-ger-to-xlsx.js
 * Requires: exceljs (npm install exceljs)
 *
 * Run scripts/pim-ger-report.js first to refresh the JSON inputs.
 */

const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("exceljs");

const DATA_DIR = path.join(__dirname, "..", "data", "pim-ger");
const JSON_PATH = path.join(DATA_DIR, "pim-ger-report.json");
const ENTRIES_CSV = path.join(DATA_DIR, "pim-ger-entries.csv");
const CANDS_CSV = path.join(DATA_DIR, "pim-ger-candidates.csv");
const OUT_PATH = path.join(DATA_DIR, "pim-ger-report.xlsx");

function parseCsv(text) {
  if (!text) return [];
  const rows = [];
  let i = 0;
  let cur = [""];
  let inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur[cur.length - 1] += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      cur[cur.length - 1] += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { cur.push(""); i++; continue; }
    if (c === "\n") { rows.push(cur); cur = [""]; i++; continue; }
    if (c === "\r") { i++; continue; }
    cur[cur.length - 1] += c; i++;
  }
  if (cur.length > 1 || cur[0] !== "") rows.push(cur);
  return rows;
}

function csvToObjects(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, idx) => [h, r[idx] ?? ""])));
}

function hours(minutes) {
  return minutes ? Number((minutes / 60).toFixed(2)) : 0;
}

function setCols(sheet, defs) {
  sheet.columns = defs.map((d) => ({ ...d }));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: "middle" };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

function autoFilter(sheet) {
  const last = sheet.columns?.length || 1;
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: last },
  };
}

function buildSummarySheet(wb, report) {
  const s = wb.addWorksheet("Summary", { views: [{ state: "frozen", ySplit: 2 }] });
  s.columns = [
    { header: "", key: "label", width: 50 },
    { header: "", key: "value", width: 20 },
    { header: "", key: "extra", width: 30 },
  ];
  s.mergeCells("A1:C1");
  const title = s.getCell("A1");
  title.value = `PIM GER — Worked-time report (Epic ${report.epic.key})`;
  title.font = { bold: true, size: 14 };
  title.alignment = { horizontal: "left" };
  s.getRow(2).values = ["Generated", report.generated_at, ""];
  s.getRow(2).getCell(1).font = { italic: true, color: { argb: "FF666666" } };

  const t = report.totals;
  const aggEstMin = t.aggregate_original_estimate_seconds
    ? Math.round(t.aggregate_original_estimate_seconds / 60)
    : null;

  const rows = [
    [],
    ["Headline totals", "Hours", "Notes"],
    ["Total time logged (combined)", hours(t.combined_minutes), "JIRA-linked + Germany keyword candidates"],
    ["  ├─ JIRA-linked", hours(t.jira_linked_minutes), `${t.jira_linked_entries} entries · ${pctStr(t.jira_linked_minutes, t.combined_minutes)} of total`],
    ["  └─ Germany keyword candidates", hours(t.keyword_candidate_minutes), `${t.keyword_candidate_entries} entries · ${pctStr(t.keyword_candidate_minutes, t.combined_minutes)} of total`],
    ["Billable (combined)", hours(t.combined_billable_minutes), ""],
    [],
    ["JIRA original estimate", "Hours", "Notes"],
    ["Aggregate estimate (epic + children)", aggEstMin != null ? hours(aggEstMin) : "—", aggEstMin != null ? "Only 3 of 11 child tickets have estimates set" : "Not set"],
    ["Consumed by JIRA-linked work", aggEstMin ? pctStr(t.jira_linked_minutes, aggEstMin) : "—", ""],
    ["Consumed by all PIM GER work", aggEstMin ? pctStr(t.combined_minutes, aggEstMin) : "—", ""],
    [],
    ["Epic", "", ""],
    ["Key", report.epic.key, ""],
    ["Summary", report.epic.summary, ""],
    ["Status", report.epic.status, ""],
    ["Child tickets", report.children.length, ""],
  ];
  for (const r of rows) s.addRow(r);
  for (let r = 4; r <= s.rowCount; r++) {
    const cell = s.getCell(r, 1);
    if (cell.value && typeof cell.value === "string" && /^[A-Z]/.test(cell.value) && !cell.value.startsWith(" ")) {
      cell.font = { bold: true };
    }
  }
  // Section header rows
  for (const r of [3, 8, 13]) {
    s.getRow(r).font = { bold: true };
    s.getRow(r).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
  }
  return s;
}

function pctStr(part, total) {
  return total ? `${((part / total) * 100).toFixed(1)}%` : "—";
}

function buildPerTaskSheet(wb, report) {
  const s = wb.addWorksheet("Per task");
  setCols(s, [
    { header: "Key", key: "key", width: 12 },
    { header: "Type", key: "type", width: 12 },
    { header: "Summary", key: "summary", width: 56 },
    { header: "Status", key: "status", width: 14 },
    { header: "Estimate (h)", key: "estimate_h", width: 12 },
    { header: "Logged (h)", key: "logged_h", width: 11 },
    { header: "Billable (h)", key: "billable_h", width: 12 },
    { header: "Consumed", key: "consumed", width: 11 },
    { header: "% of total", key: "share", width: 11 },
    { header: "Entries", key: "entries", width: 9 },
  ]);
  const totalMinutes = report.totals.combined_minutes;
  for (const t of report.tasks) {
    const estSec = t.original_estimate_seconds;
    const estMin = estSec ? Math.round(estSec / 60) : null;
    s.addRow({
      key: t.key,
      type: t.pseudo ? "Unlinked section" : "JIRA ticket",
      summary: t.summary || "",
      status: t.status || (t.pseudo ? "unlinked" : ""),
      estimate_h: estMin != null ? hours(estMin) : null,
      logged_h: hours(t.minutes),
      billable_h: hours(t.billable_minutes),
      consumed: estMin ? t.minutes / estMin : null,
      share: totalMinutes ? t.minutes / totalMinutes : 0,
      entries: t.entries,
    });
  }
  // Totals row
  const totalsRow = s.addRow({
    key: "TOTAL",
    type: "",
    summary: "",
    status: "",
    estimate_h: report.totals.aggregate_original_estimate_seconds
      ? hours(Math.round(report.totals.aggregate_original_estimate_seconds / 60))
      : null,
    logged_h: hours(report.totals.combined_minutes),
    billable_h: hours(report.totals.combined_billable_minutes),
    consumed: null,
    share: 1,
    entries: report.totals.jira_linked_entries + report.totals.keyword_candidate_entries,
  });
  totalsRow.font = { bold: true };
  totalsRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };

  for (const col of ["estimate_h", "logged_h", "billable_h"]) {
    s.getColumn(col).numFmt = "0.00";
  }
  s.getColumn("consumed").numFmt = "0.0%";
  s.getColumn("share").numFmt = "0.0%";
  autoFilter(s);
  return s;
}

function buildPerPersonSheet(wb, report) {
  const s = wb.addWorksheet("Per person");
  setCols(s, [
    { header: "Person", key: "name", width: 28 },
    { header: "Logged (h)", key: "logged_h", width: 12 },
    { header: "Billable (h)", key: "billable_h", width: 12 },
    { header: "Entries", key: "entries", width: 9 },
    { header: "% of total", key: "share", width: 11 },
  ]);
  const total = report.totals.combined_minutes;
  for (const p of report.people_totals_combined) {
    s.addRow({
      name: p.name,
      logged_h: hours(p.minutes),
      billable_h: hours(p.billable_minutes),
      entries: p.entries,
      share: total ? p.minutes / total : 0,
    });
  }
  const totalsRow = s.addRow({
    name: "TOTAL",
    logged_h: hours(report.totals.combined_minutes),
    billable_h: hours(report.totals.combined_billable_minutes),
    entries: report.totals.jira_linked_entries + report.totals.keyword_candidate_entries,
    share: 1,
  });
  totalsRow.font = { bold: true };
  totalsRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
  s.getColumn("logged_h").numFmt = "0.00";
  s.getColumn("billable_h").numFmt = "0.00";
  s.getColumn("share").numFmt = "0.0%";
  autoFilter(s);
  return s;
}

function buildPivotSheet(wb, report) {
  const s = wb.addWorksheet("Pivot");
  // Build matrix: rows = people, cols = tasks (only those with time logged)
  const tasks = report.tasks.filter((t) => t.minutes > 0);
  const peopleSet = new Set();
  for (const t of tasks) for (const p of t.people) peopleSet.add(p.name);
  const people = [...peopleSet].sort();

  const headers = ["Person", ...tasks.map((t) => t.key), "Total (h)"];
  const colDefs = [
    { header: "Person", key: "person", width: 28 },
    ...tasks.map((t) => ({ header: t.key, key: t.key, width: 14 })),
    { header: "Total (h)", key: "total", width: 11 },
  ];
  setCols(s, colDefs);

  // Add a second header row with the task summary
  const summaryRow = s.addRow(["", ...tasks.map((t) => (t.summary || "").slice(0, 60)), ""]);
  summaryRow.font = { italic: true, color: { argb: "FF666666" } };
  summaryRow.height = 30;
  summaryRow.alignment = { wrapText: true, vertical: "top" };

  for (const name of people) {
    const row = { person: name, total: 0 };
    let total = 0;
    for (const t of tasks) {
      const p = t.people.find((p) => p.name === name);
      const h = p ? hours(p.minutes) : 0;
      row[t.key] = h;
      total += h;
    }
    row.total = Number(total.toFixed(2));
    s.addRow(row);
  }
  // Footer row: per-task totals
  const totalRow = { person: "TOTAL", total: hours(report.totals.combined_minutes) };
  for (const t of tasks) totalRow[t.key] = hours(t.minutes);
  const tr = s.addRow(totalRow);
  tr.font = { bold: true };
  tr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };

  for (const t of tasks) s.getColumn(t.key).numFmt = "0.00";
  s.getColumn("total").numFmt = "0.00";
  // Freeze first row + first column
  s.views = [{ state: "frozen", xSplit: 1, ySplit: 2 }];
  return s;
}

function buildAllEntriesSheet(wb) {
  const s = wb.addWorksheet("All entries");
  setCols(s, [
    { header: "Date", key: "date", width: 12 },
    { header: "Source", key: "source", width: 18 },
    { header: "Person", key: "person_name", width: 22 },
    { header: "Hours", key: "hours", width: 8 },
    { header: "Billable", key: "billable_hours", width: 9 },
    { header: "JIRA key", key: "jira_issue_id", width: 12 },
    { header: "JIRA summary", key: "jira_issue_summary", width: 42 },
    { header: "JIRA status", key: "jira_issue_status", width: 14 },
    { header: "Productive section", key: "section_name", width: 32 },
    { header: "Service", key: "service_name", width: 26 },
    { header: "Matched (keyword)", key: "matched", width: 22 },
    { header: "Note", key: "note_text", width: 80 },
    { header: "JIRA worklog id", key: "jira_worklog_id", width: 16 },
  ]);

  const entries = csvToObjects(fs.readFileSync(ENTRIES_CSV, "utf8"));
  for (const e of entries) {
    s.addRow({
      date: e.date,
      source: "JIRA-linked",
      person_name: e.person_name,
      hours: hours(Number(e.minutes)),
      billable_hours: hours(Number(e.billable_minutes)),
      jira_issue_id: e.jira_issue_id,
      jira_issue_summary: e.jira_issue_summary,
      jira_issue_status: e.jira_issue_status,
      section_name: "",       // not exported in entries CSV; left blank for these rows
      service_name: e.service_name,
      matched: "",
      note_text: e.note_text,
      jira_worklog_id: e.jira_worklog_id,
    });
  }
  const cands = csvToObjects(fs.readFileSync(CANDS_CSV, "utf8"));
  for (const c of cands) {
    s.addRow({
      date: c.date,
      source: "Germany keyword (unlinked)",
      person_name: c.person_name,
      hours: hours(Number(c.minutes)),
      billable_hours: hours(Number(c.billable_minutes)),
      jira_issue_id: c.jira_issue_id,
      jira_issue_summary: c.jira_issue_summary,
      jira_issue_status: "",
      section_name: c.section_name,
      service_name: c.service_name,
      matched: `${c.matched_field}:${c.matched_term} (${c.matched_text})`,
      note_text: c.note_text,
      jira_worklog_id: "",
    });
  }
  s.getColumn("hours").numFmt = "0.00";
  s.getColumn("billable_hours").numFmt = "0.00";
  autoFilter(s);
  // Sort visually by date desc by leaving as-is (CSV was date asc for entries;
  // candidates inserted after). The autoFilter lets the user resort.
  return s;
}

function main() {
  if (!fs.existsSync(JSON_PATH)) {
    throw new Error(`Missing ${JSON_PATH}. Run scripts/pim-ger-report.js first.`);
  }
  const report = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));

  const wb = new ExcelJS.Workbook();
  wb.creator = "scripts/pim-ger-to-xlsx.js";
  wb.created = new Date();
  wb.title = "PIM GER worked-time report";

  buildSummarySheet(wb, report);
  buildPerTaskSheet(wb, report);
  buildPerPersonSheet(wb, report);
  buildPivotSheet(wb, report);
  buildAllEntriesSheet(wb);

  return wb.xlsx.writeFile(OUT_PATH).then(() => {
    console.log(`Wrote ${OUT_PATH}`);
    console.log(`Sheets: Summary, Per task, Per person, Pivot, All entries`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
