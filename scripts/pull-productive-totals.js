#!/usr/bin/env node
/**
 * Pulls every time entry for a Productive company (no date filter) and sums
 * minutes per JIRA key. Output is the lifetime "total worked" reference shown
 * alongside the monthly worked time on the review page.
 *
 * JIRA-key resolution mirrors pull-productive-entries.js:
 *   1. native `jira_issue_id` field
 *   2. regex over the note text when (1) is empty
 *
 * Usage:
 *   node scripts/pull-productive-totals.js [companyId] <outFile>
 *
 * Env:
 *   PRODUCTIVE_API_TOKEN, PRODUCTIVE_ORG_ID         (required)
 *   PRODUCTIVE_STOCK_COMPANY_ID                     (default companyId)
 */

const fs = require("node:fs");
const path = require("node:path");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  }
}

async function fetchPage({ companyId, page, pageSize, token, orgId }) {
  const url = new URL("https://api.productive.io/api/v2/time_entries");
  url.searchParams.set("filter[company_id]", companyId);
  url.searchParams.set(
    "fields[time_entries]",
    ["date", "time", "note", "jira_issue_id"].join(","),
  );
  url.searchParams.set("page[number]", String(page));
  url.searchParams.set("page[size]", String(pageSize));

  const res = await fetch(url, {
    headers: {
      "X-Auth-Token": token,
      "X-Organization-Id": orgId,
      "Content-Type": "application/vnd.api+json",
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res.json();
}

const JIRA_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function keysFromEntry(attr) {
  if (attr.jira_issue_id) return [attr.jira_issue_id];
  const text = stripHtml(attr.note);
  if (!text) return [];
  const matches = [...text.matchAll(JIRA_KEY_RE)].map((m) => m[1]);
  return [...new Set(matches)];
}

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  let companyId = null;
  let outFile = null;
  if (args.length === 1) {
    companyId = process.env.PRODUCTIVE_STOCK_COMPANY_ID ?? null;
    outFile = args[0];
  } else if (args.length === 2) {
    companyId = args[0];
    outFile = args[1];
  }
  if (!companyId || !outFile) {
    console.error(
      "Usage: pull-productive-totals.js [companyId] <outFile>\n" +
        "  companyId falls back to PRODUCTIVE_STOCK_COMPANY_ID in .env.",
    );
    process.exit(1);
  }
  const token = process.env.PRODUCTIVE_API_TOKEN;
  const orgId = process.env.PRODUCTIVE_ORG_ID;
  if (!token || !orgId) throw new Error("Missing PRODUCTIVE_API_TOKEN or PRODUCTIVE_ORG_ID");

  const totals = new Map(); // jira_key -> minutes (entries with multiple note keys split evenly)
  let page = 1;
  const pageSize = 200;
  let entryCount = 0;
  let matchedEntryCount = 0;
  let totalPages = null;

  while (true) {
    const body = await fetchPage({ companyId, page, pageSize, token, orgId });
    if (totalPages == null) totalPages = body.meta.total_pages;

    for (const entry of body.data) {
      entryCount += 1;
      const a = entry.attributes;
      const minutes = Number(a.time ?? 0);
      if (!minutes) continue;
      const keys = keysFromEntry(a);
      if (keys.length === 0) continue;
      matchedEntryCount += 1;
      const share = minutes / keys.length;
      for (const k of keys) totals.set(k, (totals.get(k) ?? 0) + share);
    }

    process.stderr.write(`page ${page}/${totalPages} · ${entryCount} entries scanned\n`);
    if (page >= totalPages) break;
    page += 1;
  }

  // Round to whole minutes; the source field is in minutes anyway, splits
  // can produce fractions and we don't need that precision downstream.
  const out = {};
  for (const [k, v] of totals) out[k] = Math.round(v);

  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        company_id: String(companyId),
        generated_at: new Date().toISOString(),
        entries_scanned: entryCount,
        entries_with_jira_key: matchedEntryCount,
        keys: Object.keys(out).length,
        totals: out,
      },
      null,
      2,
    ),
  );
  console.log(
    `Wrote totals for ${Object.keys(out).length} JIRA keys (from ${matchedEntryCount}/${entryCount} entries) to ${outFile}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
