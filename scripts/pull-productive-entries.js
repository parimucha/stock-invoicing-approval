#!/usr/bin/env node
/**
 * Pulls all time entries for a given Productive deal/budget in a date range,
 * including JIRA integration fields and person/service relationships.
 *
 * Usage:
 *   node scripts/pull-productive-entries.js <dealId> <after:YYYY-MM-DD> <before:YYYY-MM-DD> <outFile>
 *
 * Env:
 *   PRODUCTIVE_API_TOKEN, PRODUCTIVE_ORG_ID (loaded from .env)
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

async function fetchPage({ dealId, after, before, page, pageSize, token, orgId }) {
  const url = new URL("https://api.productive.io/api/v2/time_entries");
  url.searchParams.set("filter[deal_id]", dealId);
  url.searchParams.set("filter[after]", after);
  url.searchParams.set("filter[before]", before);
  url.searchParams.set(
    "fields[time_entries]",
    [
      "date", "time", "billable_time", "note",
      "approved", "invoiced",
      "jira_issue_id", "jira_issue_summary", "jira_issue_status",
      "jira_organization", "jira_worklog_id",
      "person", "service",
    ].join(","),
  );
  url.searchParams.set("fields[people]", "first_name,last_name,email");
  url.searchParams.set("fields[services]", "name");
  url.searchParams.set("include", "person,service");
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

function indexIncluded(included) {
  const byTypeId = {};
  for (const item of included ?? []) {
    (byTypeId[item.type] ??= {})[item.id] = item;
  }
  return byTypeId;
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

function extractKeyFromNote(note) {
  const text = stripHtml(note);
  if (!text) return null;
  const matches = [...text.matchAll(JIRA_KEY_RE)].map((m) => m[1]);
  if (matches.length === 0) return null;
  const unique = [...new Set(matches)];
  return { key: unique[0], all: unique };
}

function flatten(entry, included) {
  const a = entry.attributes;
  const personRel = entry.relationships?.person?.data;
  const serviceRel = entry.relationships?.service?.data;
  const person = personRel ? included["people"]?.[personRel.id] : null;
  const service = serviceRel ? included["services"]?.[serviceRel.id] : null;
  const personName = person
    ? [person.attributes.first_name, person.attributes.last_name].filter(Boolean).join(" ")
    : null;

  let jiraKey = a.jira_issue_id ?? null;
  let jiraKeySource = jiraKey ? "productive_field" : null;
  let extraKeysInNote = [];
  const fromNote = extractKeyFromNote(a.note);
  if (fromNote) {
    if (!jiraKey) {
      jiraKey = fromNote.key;
      jiraKeySource = "note_regex";
    }
    // Also surface any other keys mentioned in the note (for transparency).
    extraKeysInNote = fromNote.all.filter((k) => k !== jiraKey);
  }

  return {
    id: entry.id,
    date: a.date,
    time_minutes: a.time,
    billable_minutes: a.billable_time,
    note_html: a.note,
    note_text: stripHtml(a.note),
    person_id: personRel?.id ?? null,
    person_name: personName,
    service_id: serviceRel?.id ?? null,
    service_name: service?.attributes?.name ?? null,
    approved: a.approved,
    invoiced: a.invoiced,
    jira_key: jiraKey,
    jira_key_source: jiraKeySource,
    extra_keys_in_note: extraKeysInNote,
    jira_issue_summary: a.jira_issue_summary ?? null,
    jira_issue_status: a.jira_issue_status ?? null,
    jira_organization: a.jira_organization ?? null,
    jira_worklog_id: a.jira_worklog_id ?? null,
  };
}

async function main() {
  loadEnv();
  const [, , dealId, after, before, outFile] = process.argv;
  if (!dealId || !after || !before || !outFile) {
    console.error("Usage: pull-productive-entries.js <dealId> <after> <before> <outFile>");
    process.exit(1);
  }
  const token = process.env.PRODUCTIVE_API_TOKEN;
  const orgId = process.env.PRODUCTIVE_ORG_ID;
  if (!token || !orgId) throw new Error("Missing PRODUCTIVE_API_TOKEN or PRODUCTIVE_ORG_ID");

  const entries = [];
  let page = 1;
  const pageSize = 200;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const body = await fetchPage({ dealId, after, before, page, pageSize, token, orgId });
    const included = indexIncluded(body.included);
    for (const entry of body.data) entries.push(flatten(entry, included));
    if (page >= body.meta.total_pages) break;
    page += 1;
  }

  fs.writeFileSync(
    outFile,
    JSON.stringify(
      { deal_id: dealId, after, before, count: entries.length, entries },
      null,
      2,
    ),
  );
  console.log(`Wrote ${entries.length} entries to ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
