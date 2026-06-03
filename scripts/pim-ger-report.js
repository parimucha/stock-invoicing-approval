#!/usr/bin/env node
/**
 * Build a worked-time report for the "PIM GER" epic (PCM2-229).
 *
 * 1. Fetches the epic + child issues from JIRA.
 * 2. Pulls all Productive time entries for the Stock Plzeň-Božkov company
 *    (id 1055199 — the only company tagged with PCM2-* tickets).
 * 3. Filters entries whose Productive `jira_issue_id` (set by the JIRA
 *    integration) matches one of the epic tickets. Note-only mentions of
 *    those keys are reported separately so they're visible but not double
 *    counted.
 * 4. Groups by JIRA task, then by person within each task. Writes a JSON
 *    report, a flat per-entry CSV, and prints a readable text summary.
 *
 * Usage:
 *   node scripts/pim-ger-report.js
 *
 * Env: PRODUCTIVE_API_TOKEN, PRODUCTIVE_ORG_ID, JIRA_BASE_URL,
 *      JIRA_API_EMAIL, JIRA_API_TOKEN (loaded from .env at repo root).
 */

const fs = require("node:fs");
const path = require("node:path");

const EPIC_KEY = "PCM2-229";
const COMPANY_ID = "1055199";
const OUT_DIR = path.join(__dirname, "..", "data", "pim-ger");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

async function jiraAuth() {
  const base = (process.env.JIRA_BASE_URL || "").replace(/\/+$/, "");
  const email = process.env.JIRA_API_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!base || !email || !token) throw new Error("Missing JIRA creds in .env");
  const auth = "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
  const tenant = await fetch(`${base}/_edge/tenant_info`);
  if (!tenant.ok) throw new Error(`tenant_info ${tenant.status}`);
  const { cloudId } = await tenant.json();
  return { apiBase: `https://api.atlassian.com/ex/jira/${cloudId}`, auth };
}

async function fetchEpicAndChildren({ apiBase, auth }) {
  const jql = `key = ${EPIC_KEY} OR parent = ${EPIC_KEY} OR "Epic Link" = ${EPIC_KEY}`;
  const headers = { Authorization: auth, Accept: "application/json", "Content-Type": "application/json" };
  const issues = [];
  let nextPageToken;
  while (true) {
    const res = await fetch(`${apiBase}/rest/api/3/search/jql`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jql,
        fields: [
          "summary", "status", "assignee", "issuetype",
          "timetracking", "timeoriginalestimate", "aggregatetimeoriginalestimate",
        ],
        maxResults: 100,
        ...(nextPageToken ? { nextPageToken } : {}),
      }),
    });
    if (!res.ok) throw new Error(`JIRA ${res.status}: ${await res.text()}`);
    const body = await res.json();
    for (const i of body.issues || []) {
      const f = i.fields || {};
      const tt = f.timetracking || {};
      const ownSeconds = tt.originalEstimateSeconds ?? f.timeoriginalestimate ?? null;
      const aggSeconds = f.aggregatetimeoriginalestimate ?? null;
      issues.push({
        key: i.key,
        summary: f.summary || null,
        status: f.status?.name || null,
        type: f.issuetype?.name || null,
        assignee: f.assignee?.displayName || null,
        original_estimate_seconds: ownSeconds,
        original_estimate_formatted: tt.originalEstimate || null,
        aggregate_original_estimate_seconds: aggSeconds,
      });
    }
    if (body.isLast || !body.nextPageToken) break;
    nextPageToken = body.nextPageToken;
  }
  return issues;
}

async function fetchAllProductiveEntries() {
  const token = process.env.PRODUCTIVE_API_TOKEN;
  const orgId = process.env.PRODUCTIVE_ORG_ID;
  if (!token || !orgId) throw new Error("Missing PRODUCTIVE_API_TOKEN/ORG_ID");
  const headers = {
    "X-Auth-Token": token,
    "X-Organization-Id": orgId,
    "Content-Type": "application/vnd.api+json",
  };
  const entries = [];
  let included = [];
  let page = 1;
  const pageSize = 200;
  while (true) {
    const url = new URL("https://api.productive.io/api/v2/time_entries");
    url.searchParams.set("filter[company_id]", COMPANY_ID);
    url.searchParams.set(
      "fields[time_entries]",
      "date,time,billable_time,note,approved,invoiced,jira_issue_id,jira_issue_summary,jira_issue_status,jira_worklog_id,person,service",
    );
    url.searchParams.set("fields[people]", "first_name,last_name,email");
    url.searchParams.set("fields[services]", "name,section");
    url.searchParams.set("fields[sections]", "name");
    url.searchParams.set("include", "person,service,service.section");
    url.searchParams.set("page[number]", String(page));
    url.searchParams.set("page[size]", String(pageSize));
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Productive ${res.status}: ${await res.text()}`);
    const body = await res.json();
    entries.push(...body.data);
    included.push(...(body.included || []));
    process.stderr.write(`  page ${page}/${body.meta.total_pages} · ${entries.length}/${body.meta.total_count}\n`);
    if (page >= body.meta.total_pages) break;
    page += 1;
  }
  const byTypeId = {};
  for (const item of included) (byTypeId[item.type] ??= {})[item.id] = item;
  return { entries, byTypeId };
}

const JIRA_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/g;
function stripHtml(html) {
  return (html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}
function notesContainKey(note, keySet) {
  const text = stripHtml(note);
  if (!text) return null;
  for (const m of text.matchAll(JIRA_KEY_RE)) {
    if (keySet.has(m[1])) return m[1];
  }
  return null;
}

function flatten(entry, byTypeId) {
  const a = entry.attributes;
  const personId = entry.relationships?.person?.data?.id;
  const serviceId = entry.relationships?.service?.data?.id;
  const person = personId ? byTypeId["people"]?.[personId] : null;
  const service = serviceId ? byTypeId["services"]?.[serviceId] : null;
  const sectionId = service?.relationships?.section?.data?.id || null;
  const section = sectionId ? byTypeId["sections"]?.[sectionId] : null;
  const personName = person
    ? [person.attributes.first_name, person.attributes.last_name].filter(Boolean).join(" ")
    : null;
  return {
    id: entry.id,
    date: a.date,
    minutes: a.time || 0,
    billable_minutes: a.billable_time || 0,
    note_text: stripHtml(a.note),
    person_id: personId || null,
    person_name: personName,
    person_email: person?.attributes?.email || null,
    service_id: serviceId || null,
    service_name: service?.attributes?.name || null,
    section_id: sectionId,
    section_name: section?.attributes?.name || null,
    approved: a.approved,
    invoiced: a.invoiced,
    jira_issue_id: a.jira_issue_id || null,
    jira_issue_summary: a.jira_issue_summary || null,
    jira_issue_status: a.jira_issue_status || null,
    jira_worklog_id: a.jira_worklog_id || null,
  };
}

// Keyword patterns for "Germany-related" entries that lack a JIRA link.
// Cautious to avoid false positives: ALL-CAPS-only for short codes (DE/GER),
// word-boundary anchored. Czech "německ" stem covers Německo / německý / etc.
const GERMANY_PATTERNS = [
  { re: /\bgerman(y|s)?\b/i, label: "germany" },
  { re: /\bdeutsch(land)?\b/i, label: "deutsch" },
  { re: /\bněmeck/i, label: "německ* (cs)" },
  { re: /\bnemeck/i, label: "nemeck* (cs no-diacritics)" },
  { re: /\bGER\b/, label: "GER" },
  { re: /\bDE\b/, label: "DE" },
  { re: /\bPosDE\b/i, label: "PosDE" },
  { re: /\bProductDE\b/i, label: "ProductDE" },
];

function matchGermany(text) {
  if (!text) return null;
  for (const { re, label } of GERMANY_PATTERNS) {
    const m = text.match(re);
    if (m) return { term: label, matched: m[0] };
  }
  return null;
}

function germanyHits(f) {
  const hits = [];
  const n = matchGermany(f.note_text);
  if (n) hits.push({ field: "note", ...n });
  const s = matchGermany(f.service_name);
  if (s) hits.push({ field: "service", ...s });
  const sec = matchGermany(f.section_name);
  if (sec) hits.push({ field: "section", ...sec });
  return hits;
}

function fmtHM(minutes) {
  const sign = minutes < 0 ? "-" : "";
  const m = Math.abs(minutes);
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `${sign}${h}h ${String(rem).padStart(2, "0")}m`;
}
function pct(part, total) {
  return total ? `${((part / total) * 100).toFixed(1)}%` : "—";
}
function pad(s, n) {
  s = String(s ?? "");
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function buildReport(epic, children, entriesRaw, byTypeId) {
  const keys = new Set([epic.key, ...children.map((c) => c.key)]);
  const issueMeta = new Map();
  issueMeta.set(epic.key, epic);
  for (const c of children) issueMeta.set(c.key, c);

  const direct = [];        // jira_issue_id matches an epic ticket
  const noteOnly = [];      // note mentions an epic ticket but jira_issue_id is empty
  const keywordOnly = [];   // no JIRA link to epic, but Germany keyword hit in note/service/section
  for (const e of entriesRaw) {
    const f = flatten(e, byTypeId);
    if (f.jira_issue_id && keys.has(f.jira_issue_id)) {
      direct.push(f);
      continue;
    }
    const noteKey = notesContainKey(f.note_text, keys);
    if (noteKey) {
      f._note_key = noteKey;
      noteOnly.push(f);
      continue;
    }
    // Avoid double-counting entries that ARE linked to a different (non-epic)
    // JIRA ticket — surface them but mark the link so the user can decide.
    const hits = germanyHits(f);
    if (hits.length > 0) {
      f._germany_hits = hits;
      keywordOnly.push(f);
    }
  }

  // group: task → person → totals
  const tasks = new Map();
  for (const f of direct) {
    const t = tasks.get(f.jira_issue_id) || {
      key: f.jira_issue_id,
      meta: issueMeta.get(f.jira_issue_id) || null,
      people: new Map(),
      minutes: 0,
      billable_minutes: 0,
      entries: 0,
    };
    const p = t.people.get(f.person_name || "(unknown)") || {
      name: f.person_name || "(unknown)",
      email: f.person_email,
      minutes: 0,
      billable_minutes: 0,
      entries: 0,
    };
    p.minutes += f.minutes;
    p.billable_minutes += f.billable_minutes;
    p.entries += 1;
    t.people.set(p.name, p);
    t.minutes += f.minutes;
    t.billable_minutes += f.billable_minutes;
    t.entries += 1;
    tasks.set(t.key, t);
  }

  const grandTotal = direct.reduce((a, f) => a + f.minutes, 0);
  const grandBillable = direct.reduce((a, f) => a + f.billable_minutes, 0);

  // overall per-person totals
  const peopleTotals = new Map();
  for (const f of direct) {
    const p = peopleTotals.get(f.person_name || "(unknown)") || {
      name: f.person_name || "(unknown)",
      minutes: 0,
      billable_minutes: 0,
      entries: 0,
    };
    p.minutes += f.minutes;
    p.billable_minutes += f.billable_minutes;
    p.entries += 1;
    peopleTotals.set(p.name, p);
  }

  // tasks with no logged time — still show them so the report is complete
  for (const c of children) {
    if (!tasks.has(c.key)) {
      tasks.set(c.key, {
        key: c.key,
        meta: c,
        people: new Map(),
        minutes: 0,
        billable_minutes: 0,
        entries: 0,
      });
    }
  }

  const candidateMinutes = keywordOnly.reduce((a, f) => a + f.minutes, 0);
  const candidateBillable = keywordOnly.reduce((a, f) => a + f.billable_minutes, 0);

  // Bucket keyword candidates by the matched term for an at-a-glance view.
  const candidateByTerm = new Map();
  for (const f of keywordOnly) {
    const term = f._germany_hits[0].term;
    const g = candidateByTerm.get(term) || { term, entries: [], minutes: 0 };
    g.entries.push(f);
    g.minutes += f.minutes;
    candidateByTerm.set(term, g);
  }

  // Synthesise pseudo-tasks for the unlinked candidates, grouped by
  // Productive section. These slot into the same per-task list as the
  // JIRA-linked tickets so the report reads as one combined view.
  const sectionTasks = new Map();
  for (const f of keywordOnly) {
    const sec = f.section_name || "(no section)";
    const key = `(unlinked) ${sec}`;
    const t = sectionTasks.get(key) || {
      key,
      pseudo: true,
      meta: {
        summary: `unlinked — Productive section: ${sec}`,
        status: null,
        original_estimate_seconds: null,
      },
      people: new Map(),
      minutes: 0,
      billable_minutes: 0,
      entries: 0,
      services: new Map(),
    };
    const p = t.people.get(f.person_name || "(unknown)") || {
      name: f.person_name || "(unknown)",
      email: f.person_email,
      minutes: 0, billable_minutes: 0, entries: 0,
    };
    p.minutes += f.minutes;
    p.billable_minutes += f.billable_minutes;
    p.entries += 1;
    t.people.set(p.name, p);
    const svc = f.service_name || "(no service)";
    t.services.set(svc, (t.services.get(svc) || 0) + f.minutes);
    t.minutes += f.minutes;
    t.billable_minutes += f.billable_minutes;
    t.entries += 1;
    sectionTasks.set(key, t);
  }

  // Combined per-person totals across both buckets.
  const peopleCombined = new Map();
  for (const list of [direct, keywordOnly]) {
    for (const f of list) {
      const p = peopleCombined.get(f.person_name || "(unknown)") || {
        name: f.person_name || "(unknown)",
        minutes: 0, billable_minutes: 0, entries: 0,
      };
      p.minutes += f.minutes;
      p.billable_minutes += f.billable_minutes;
      p.entries += 1;
      peopleCombined.set(p.name, p);
    }
  }

  const combinedTotal = grandTotal + candidateMinutes;
  const combinedBillable = grandBillable + candidateBillable;
  const allTasks = [...tasks.values(), ...sectionTasks.values()]
    .sort((a, b) => b.minutes - a.minutes);

  return {
    epic,
    children,
    grandTotal,           // bucket A only
    grandBillable,
    candidateMinutes,     // bucket B only
    candidateBillable,
    combinedTotal,        // A + B
    combinedBillable,
    tasks: allTasks,
    peopleTotals: [...peopleTotals.values()].sort((a, b) => b.minutes - a.minutes),
    peopleCombined: [...peopleCombined.values()].sort((a, b) => b.minutes - a.minutes),
    direct,
    noteOnly,
    keywordOnly,
    candidateByTerm: [...candidateByTerm.values()].sort((a, b) => b.minutes - a.minutes),
  };
}

function renderText(r) {
  const lines = [];
  lines.push(`PIM GER worked-time report`);
  lines.push(`Epic ${r.epic.key} — ${r.epic.summary}  [${r.epic.status}]`);
  lines.push(`Generated: ${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC`);
  lines.push("=".repeat(78));
  lines.push("");
  const epicEstSec = r.epic.aggregate_original_estimate_seconds ?? r.epic.original_estimate_seconds;
  const epicEstMin = epicEstSec ? Math.round(epicEstSec / 60) : null;
  lines.push(`Total time logged: ${fmtHM(r.combinedTotal)}  (billable: ${fmtHM(r.combinedBillable)})`);
  lines.push(`  ├─ via JIRA integration:    ${fmtHM(r.grandTotal)}  (${r.direct.length} entries, ${pct(r.grandTotal, r.combinedTotal)})`);
  lines.push(`  └─ Germany keyword matches: ${fmtHM(r.candidateMinutes)}  (${r.keywordOnly.length} entries, ${pct(r.candidateMinutes, r.combinedTotal)})`);
  if (epicEstMin != null) {
    lines.push(`Aggregate original estimate (epic + children): ${fmtHM(epicEstMin)}  ·  consumed by linked work: ${pct(r.grandTotal, epicEstMin)}  ·  consumed by all PIM GER work: ${pct(r.combinedTotal, epicEstMin)}`);
  } else {
    lines.push(`Aggregate original estimate (epic + children): not set in JIRA`);
  }
  if (r.noteOnly.length > 0) {
    lines.push(`Note-only PCM2-229 mentions: ${r.noteOnly.length} entries (excluded — JIRA key in note but no integration link)`);
  }
  lines.push("");
  lines.push("UNIFIED TASK BREAKDOWN (sorted by time; JIRA-linked tickets + unlinked Productive sections)");
  lines.push("-".repeat(96));
  for (const t of r.tasks) {
    const m = t.meta || {};
    const estSec = m.original_estimate_seconds;
    const estMin = estSec ? Math.round(estSec / 60) : null;
    const estStr = estMin != null ? fmtHM(estMin) : "—";
    const consumed = estMin ? pct(t.minutes, estMin) : "";
    const statusStr = m.status ? `[${m.status}]` : t.pseudo ? "[unlinked]" : "[?]";
    const head = `${t.key.padEnd(10)} ${pad((m.summary || "").slice(0, 52), 52)} ${statusStr}`;
    lines.push(`\n${head}`);
    const consumedLabel = consumed ? `  ·  consumed: ${consumed}` : "";
    lines.push(`  Est: ${pad(estStr, 8)}  Logged: ${fmtHM(t.minutes)}  ·  Billable: ${fmtHM(t.billable_minutes)}  ·  ${t.entries} entries  ·  ${pct(t.minutes, r.combinedTotal)} of total${consumedLabel}`);
    if (t.pseudo && t.services && t.services.size > 0) {
      const svcs = [...t.services.entries()].sort((a, b) => b[1] - a[1]);
      const svcList = svcs.map(([n, mins]) => `${n} ${fmtHM(mins)}`).join("  ·  ");
      lines.push(`  Services: ${svcList}`);
    }
    if (t.people.size === 0) {
      if (t.minutes === 0) lines.push(`  (no time logged)`);
      continue;
    }
    const people = [...t.people.values()].sort((a, b) => b.minutes - a.minutes);
    for (const p of people) {
      lines.push(`    ${pad(p.name, 28)} ${pad(fmtHM(p.minutes), 12)} bill ${pad(fmtHM(p.billable_minutes), 12)} (${p.entries} entries)`);
    }
  }
  lines.push("");
  lines.push("PER-PERSON TOTALS (combined: JIRA-linked + Germany keyword candidates)");
  lines.push("-".repeat(96));
  for (const p of r.peopleCombined) {
    lines.push(`  ${pad(p.name, 28)} ${pad(fmtHM(p.minutes), 12)} bill ${pad(fmtHM(p.billable_minutes), 12)} (${p.entries} entries, ${pct(p.minutes, r.combinedTotal)})`);
  }
  if (r.noteOnly.length > 0) {
    lines.push("");
    lines.push(`NOTE-ONLY EPIC MATCHES (${r.noteOnly.length}) — JIRA key appears in note text but jira_issue_id is empty`);
    lines.push("-".repeat(78));
    lines.push("Not counted in totals above. Likely the JIRA integration didn't link the worklog.");
    const byKey = new Map();
    for (const e of r.noteOnly) {
      const k = e._note_key;
      (byKey.get(k) || byKey.set(k, []).get(k)).push(e);
    }
    for (const [k, list] of [...byKey.entries()].sort()) {
      const mins = list.reduce((a, e) => a + e.minutes, 0);
      lines.push(`  ${k}: ${list.length} entries · ${fmtHM(mins)}`);
    }
  }

  lines.push("");
  lines.push(`GERMANY KEYWORD CANDIDATES — ${r.keywordOnly.length} entries · ${fmtHM(r.candidateMinutes)} (billable ${fmtHM(r.candidateBillable)})`);
  lines.push("-".repeat(78));
  lines.push("Entries NOT linked to PCM2-229 children, but containing a Germany keyword");
  lines.push("in the note, service, or section. Listed for your review — NOT counted in");
  lines.push("the per-task totals above. Patterns searched (word-boundary anchored):");
  lines.push("  /germany/i, /deutsch(land)?/i, /německ/i (cs), /nemeck/i,");
  lines.push("  /\\bGER\\b/, /\\bDE\\b/ (both case-sensitive), /PosDE/i, /ProductDE/i");
  lines.push("");
  if (r.keywordOnly.length === 0) {
    lines.push("  (none)");
  } else {
    lines.push("Hits grouped by matched term:");
    for (const g of r.candidateByTerm) {
      lines.push(`  ${pad(g.term, 26)} ${g.entries.length} entries · ${fmtHM(g.minutes)}`);
    }
    lines.push("");
    lines.push("Per entry (sorted by date desc):");
    const rows = r.keywordOnly.slice().sort((a, b) => b.date.localeCompare(a.date));
    for (const e of rows) {
      const hit = e._germany_hits[0];
      const where = `${hit.field}:"${hit.matched}"`;
      const tag = e.jira_issue_id ? `[${e.jira_issue_id}]` : "[no jira link]";
      const noteSnip = (e.note_text || "").slice(0, 60).replace(/\s+/g, " ");
      const sectionLabel = e.section_name ? ` § ${e.section_name}` : "";
      const serviceLabel = e.service_name || "(no service)";
      lines.push(`  ${e.date} ${pad(e.person_name || "?", 20)} ${pad(fmtHM(e.minutes), 8)} ${pad(where, 28)} ${tag}`);
      lines.push(`      svc: ${serviceLabel}${sectionLabel}`);
      if (noteSnip) lines.push(`      note: ${noteSnip}${e.note_text.length > 60 ? "…" : ""}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function toCsv(rows, columns) {
  const esc = (v) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join("\n");
}

async function main() {
  loadEnv();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  process.stderr.write(`Fetching JIRA epic ${EPIC_KEY} and children…\n`);
  const j = await jiraAuth();
  const issues = await fetchEpicAndChildren(j);
  const epic = issues.find((i) => i.key === EPIC_KEY);
  if (!epic) throw new Error(`Epic ${EPIC_KEY} not found`);
  const children = issues.filter((i) => i.key !== EPIC_KEY);
  process.stderr.write(`  epic + ${children.length} children\n`);

  process.stderr.write(`Fetching all Productive entries for company ${COMPANY_ID}…\n`);
  const { entries, byTypeId } = await fetchAllProductiveEntries();

  const report = buildReport(epic, children, entries, byTypeId);

  // Outputs
  const jsonPath = path.join(OUT_DIR, "pim-ger-report.json");
  const txtPath = path.join(OUT_DIR, "pim-ger-report.txt");
  const csvPath = path.join(OUT_DIR, "pim-ger-entries.csv");

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        epic: report.epic,
        children: report.children,
        totals: {
          combined_minutes: report.combinedTotal,
          combined_billable_minutes: report.combinedBillable,
          jira_linked_minutes: report.grandTotal,
          jira_linked_billable_minutes: report.grandBillable,
          jira_linked_entries: report.direct.length,
          keyword_candidate_minutes: report.candidateMinutes,
          keyword_candidate_billable_minutes: report.candidateBillable,
          keyword_candidate_entries: report.keywordOnly.length,
          note_only_entries: report.noteOnly.length,
          aggregate_original_estimate_seconds:
            report.epic.aggregate_original_estimate_seconds ?? report.epic.original_estimate_seconds ?? null,
        },
        tasks: report.tasks.map((t) => ({
          key: t.key,
          pseudo: !!t.pseudo,
          summary: t.meta?.summary,
          status: t.meta?.status,
          original_estimate_seconds: t.meta?.original_estimate_seconds ?? null,
          minutes: t.minutes,
          billable_minutes: t.billable_minutes,
          entries: t.entries,
          services: t.services ? Object.fromEntries(t.services) : undefined,
          people: [...t.people.values()].sort((a, b) => b.minutes - a.minutes),
        })),
        people_totals_combined: report.peopleCombined,
        people_totals_jira_linked: report.peopleTotals,
        note_only_samples: report.noteOnly.slice(0, 50),
        keyword_candidates: report.keywordOnly.map((e) => ({
          date: e.date,
          person_name: e.person_name,
          minutes: e.minutes,
          billable_minutes: e.billable_minutes,
          service_name: e.service_name,
          section_name: e.section_name,
          jira_issue_id: e.jira_issue_id,
          jira_issue_summary: e.jira_issue_summary,
          note_text: e.note_text,
          matched: e._germany_hits,
        })),
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(txtPath, renderText(report));

  const csvColumns = [
    "date", "jira_issue_id", "jira_issue_summary", "jira_issue_status",
    "person_name", "person_email", "service_name",
    "minutes", "billable_minutes", "approved", "invoiced", "note_text", "jira_worklog_id",
  ];
  const csvRows = report.direct
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.jira_issue_id.localeCompare(b.jira_issue_id))
    .map((e) => ({
      date: e.date,
      jira_issue_id: e.jira_issue_id,
      jira_issue_summary: e.jira_issue_summary,
      jira_issue_status: e.jira_issue_status,
      person_name: e.person_name,
      person_email: e.person_email,
      service_name: e.service_name,
      minutes: e.minutes,
      billable_minutes: e.billable_minutes,
      approved: e.approved,
      invoiced: e.invoiced,
      note_text: e.note_text,
      jira_worklog_id: e.jira_worklog_id,
    }));
  fs.writeFileSync(csvPath, toCsv(csvRows, csvColumns));

  const candCsvPath = path.join(OUT_DIR, "pim-ger-candidates.csv");
  const candColumns = [
    "date", "person_name", "minutes", "billable_minutes",
    "matched_field", "matched_term", "matched_text",
    "service_name", "section_name",
    "jira_issue_id", "jira_issue_summary", "note_text",
  ];
  const candRows = report.keywordOnly
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => {
      const h = e._germany_hits[0];
      return {
        date: e.date,
        person_name: e.person_name,
        minutes: e.minutes,
        billable_minutes: e.billable_minutes,
        matched_field: h.field,
        matched_term: h.term,
        matched_text: h.matched,
        service_name: e.service_name,
        section_name: e.section_name,
        jira_issue_id: e.jira_issue_id,
        jira_issue_summary: e.jira_issue_summary,
        note_text: e.note_text,
      };
    });
  fs.writeFileSync(candCsvPath, toCsv(candRows, candColumns));

  process.stdout.write(renderText(report));
  process.stderr.write(`\nOutputs:\n  ${jsonPath}\n  ${txtPath}\n  ${csvPath}\n  ${candCsvPath}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
