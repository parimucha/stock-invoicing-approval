#!/usr/bin/env node
/**
 * Groups cached time entries by Jira ticket ID and sums time worked.
 * Matching rule: prefer the dedicated `jira_issue_id` field; if it is empty,
 * fall back to Jira keys parsed from the note.
 *
 * Usage:
 *   node scripts/group-by-jira-ticket.js <entriesJson> <ticketsCsv> <outCsv>
 */

const fs = require("node:fs");

function parseTicketsCsv(path) {
  const raw = fs.readFileSync(path, "utf8");
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const header = lines.shift();
  if (!/issue\s*key/i.test(header)) {
    throw new Error(`Expected "Issue key" header, got: ${header}`);
  }
  return lines;
}

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function main() {
  const [, , entriesPath, ticketsCsvPath, outCsvPath] = process.argv;
  if (!entriesPath || !ticketsCsvPath || !outCsvPath) {
    console.error("Usage: group-by-jira-ticket.js <entriesJson> <ticketsCsv> <outCsv>");
    process.exit(1);
  }

  const { entries } = JSON.parse(fs.readFileSync(entriesPath, "utf8"));
  const tickets = parseTicketsCsv(ticketsCsvPath);
  const ticketSet = new Set(tickets);

  const totals = new Map();
  for (const t of tickets) totals.set(t, { minutes: 0, billable: 0, entries: 0, fromField: 0, fromNote: 0 });

  let entriesMatched = 0;
  let entriesMultiMatched = 0;
  const multiMatchExamples = [];

  for (const e of entries) {
    const fieldKey = e.jira_issue_id;
    let matched = [];
    let source = null;

    if (fieldKey && ticketSet.has(fieldKey)) {
      matched = [fieldKey];
      source = "field";
    } else if (!fieldKey) {
      const noteMatches = (e.note_jira_keys ?? []).filter((k) => ticketSet.has(k));
      if (noteMatches.length > 0) {
        matched = noteMatches;
        source = "note";
      }
    }

    if (matched.length === 0) continue;
    entriesMatched += 1;
    if (matched.length > 1) {
      entriesMultiMatched += 1;
      if (multiMatchExamples.length < 5) {
        multiMatchExamples.push({ id: e.id, date: e.date, minutes: e.time_minutes, keys: matched });
      }
    }

    const share = 1 / matched.length;
    for (const key of matched) {
      const t = totals.get(key);
      t.minutes += (e.time_minutes ?? 0) * share;
      t.billable += (e.billable_minutes ?? 0) * share;
      t.entries += 1;
      if (source === "field") t.fromField += 1;
      else t.fromNote += 1;
    }
  }

  const rows = [["jira_issue_id", "total_minutes", "total_hours", "billable_minutes", "entry_count", "matched_via_field", "matched_via_note"]];
  for (const key of tickets) {
    const t = totals.get(key);
    rows.push([
      key,
      t.minutes.toFixed(2),
      (t.minutes / 60).toFixed(2),
      t.billable.toFixed(2),
      t.entries,
      t.fromField,
      t.fromNote,
    ]);
  }

  fs.writeFileSync(outCsvPath, rows.map((r) => r.map(csvEscape).join(",")).join("\n") + "\n");

  const grandMin = [...totals.values()].reduce((s, t) => s + t.minutes, 0);
  const ticketsWithHits = [...totals.values()].filter((t) => t.entries > 0).length;
  console.log(`Tickets in CSV:          ${tickets.length}`);
  console.log(`Tickets with entries:    ${ticketsWithHits}`);
  console.log(`Tickets with zero time:  ${tickets.length - ticketsWithHits}`);
  console.log(`Entries matched:         ${entriesMatched} / ${entries.length}`);
  console.log(`Entries matching 2+ CSV tickets via note: ${entriesMultiMatched}`);
  if (multiMatchExamples.length) {
    console.log("  examples (time split equally across listed tickets):");
    for (const ex of multiMatchExamples) {
      console.log(`    #${ex.id} ${ex.date} ${ex.minutes}m → ${ex.keys.join(", ")}`);
    }
  }
  console.log(`Total minutes summed:    ${grandMin.toFixed(2)} (${(grandMin / 60).toFixed(2)} h)`);
  console.log(`Wrote ${rows.length - 1} rows to ${outCsvPath}`);
}

main();
