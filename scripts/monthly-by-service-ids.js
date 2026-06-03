#!/usr/bin/env node
/**
 * Groups cached time entries by month and service name, limited to given
 * service IDs. Services with the same name across deals are merged.
 *
 * Usage:
 *   node scripts/monthly-by-service-ids.js <entriesJson> <serviceIdsJson> <outCsv>
 */

const fs = require("node:fs");

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function main() {
  const [, , entriesPath, serviceIdsPath, outCsvPath] = process.argv;
  if (!entriesPath || !serviceIdsPath || !outCsvPath) {
    console.error("Usage: monthly-by-service-ids.js <entriesJson> <serviceIdsJson> <outCsv>");
    process.exit(1);
  }
  const { entries } = JSON.parse(fs.readFileSync(entriesPath, "utf8"));
  const services = JSON.parse(fs.readFileSync(serviceIdsPath, "utf8"));
  const serviceSet = new Set(services.map((s) => String(s.id)));

  const byMonthService = new Map();
  const monthTotals = new Map();
  const serviceTotals = new Map();
  let matched = 0;

  for (const e of entries) {
    if (!serviceSet.has(String(e.service_id))) continue;
    matched += 1;
    const month = (e.date || "").slice(0, 7);
    const svc = e.service_name || "(unknown)";
    const key = `${month}|${svc}`;
    const bucket = byMonthService.get(key) ?? { month, service: svc, minutes: 0, entries: 0 };
    bucket.minutes += e.time_minutes ?? 0;
    bucket.entries += 1;
    byMonthService.set(key, bucket);

    monthTotals.set(month, (monthTotals.get(month) ?? 0) + (e.time_minutes ?? 0));
    serviceTotals.set(svc, (serviceTotals.get(svc) ?? 0) + (e.time_minutes ?? 0));
  }

  const months = [...monthTotals.keys()].sort();
  const svcs = [...serviceTotals.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);

  // Long format: one row per (month, service).
  const rows = [["month", "service", "total_minutes", "total_hours", "entry_count"]];
  for (const m of months) {
    for (const svc of svcs) {
      const b = byMonthService.get(`${m}|${svc}`);
      if (!b) continue;
      rows.push([m, svc, b.minutes, (b.minutes / 60).toFixed(2), b.entries]);
    }
  }
  const grand = [...monthTotals.values()].reduce((s, v) => s + v, 0);
  rows.push(["TOTAL", "", grand, (grand / 60).toFixed(2), matched]);

  fs.writeFileSync(outCsvPath, rows.map((r) => r.map(csvEscape).join(",")).join("\n") + "\n");

  console.log(`Entries matched: ${matched} / ${entries.length}`);
  console.log(`Months:          ${months.length}`);
  console.log(`Services:        ${svcs.length}`);
  console.log(`Grand total:     ${grand} min (${(grand / 60).toFixed(2)} h)`);
  console.log(`Wrote ${rows.length - 1} data rows to ${outCsvPath}`);
}

main();
