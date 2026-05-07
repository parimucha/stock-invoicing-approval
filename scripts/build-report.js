#!/usr/bin/env node
/**
 * Combine productive-entries.json + jira-issues.json into the upload-ready report.json
 * matching the web app's UploadReport schema.
 *
 * Usage:
 *   node scripts/build-report.js <dataDir> <periodStart:YYYY-MM-DD> <periodEnd:YYYY-MM-DD> [budgetName]
 *
 * Example:
 *   node scripts/build-report.js data/2026-03 2026-03-01 2026-03-31 "stock.cz_design&development (2026/03)"
 */

const fs = require("node:fs");
const path = require("node:path");

const PROJECT_IDS = {
  CZECH: "czech_pimcore",
  FRENCH: "french_pimcore",
  GERMAN: "german_pimcore",
  SLOVAK: "slovak_pimcore",
  SAP: "sap_spirit",
};

const PARENT_TO_PROJECT = {
  "PCM2-91": PROJECT_IDS.CZECH, // PIM CZ
  "PCM2-92": PROJECT_IDS.FRENCH, // PIM FR
  "PCM2-229": PROJECT_IDS.GERMAN, // PIM DE
  "PCM2-187": PROJECT_IDS.SLOVAK, // PIM SK
};

const LABEL_TO_PROJECT = {
  CZ: PROJECT_IDS.CZECH,
  France: PROJECT_IDS.FRENCH,
  GER: PROJECT_IDS.GERMAN,
  SK: PROJECT_IDS.SLOVAK,
};

function suggestProjects(issue) {
  if (!issue) return [];
  const out = new Set();
  if (issue.key && issue.key.startsWith("SAPS-")) {
    out.add(PROJECT_IDS.SAP);
    return [...out];
  }
  const parentProj = PARENT_TO_PROJECT[issue.parent_key];
  if (parentProj) out.add(parentProj);
  if (out.size === 0) {
    for (const l of issue.labels ?? []) {
      const p = LABEL_TO_PROJECT[l];
      if (p) out.add(p);
    }
  }
  return [...out];
}

function normalizeNote(text) {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/^\s*(pm\s*:\s*|call\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function labelFromPeriod(start) {
  return start.slice(0, 7); // YYYY-MM
}

function main() {
  const [, , dataDir, periodStart, periodEnd, budgetName] = process.argv;
  if (!dataDir || !periodStart || !periodEnd) {
    console.error(
      "Usage: build-report.js <dataDir> <periodStart> <periodEnd> [budgetName]",
    );
    process.exit(1);
  }

  const peFile = path.join(dataDir, "raw/productive-entries.json");
  const jiFile = path.join(dataDir, "raw/jira-issues.json");
  const outFile = path.join(dataDir, "report.json");

  const pe = JSON.parse(fs.readFileSync(peFile, "utf8"));
  const ji = JSON.parse(fs.readFileSync(jiFile, "utf8"));

  const issuesByKey = new Map(ji.issues.map((x) => [x.key, x]));

  // Aggregate by JIRA key (for JIRA-linked) or by normalized note (for PM items).
  const jiraAgg = new Map(); // key -> { workedMinutes, ids, people }
  const pmAgg = new Map(); // normKey -> { workedMinutes, ids, notes, people, services }

  for (const e of pe.entries) {
    if (e.jira_key) {
      const k = e.jira_key;
      const a = jiraAgg.get(k) ?? { workedMinutes: 0, ids: [], people: new Set() };
      a.workedMinutes += e.time_minutes;
      a.ids.push(e.id);
      if (e.person_name) a.people.add(e.person_name);
      jiraAgg.set(k, a);
    } else {
      const noteText = e.note_text ?? "";
      const norm = normalizeNote(noteText);
      const fallback = `${e.person_name ?? "?"} · ${e.service_name ?? "?"}`;
      const key = norm || fallback;
      const a = pmAgg.get(key) ?? {
        workedMinutes: 0,
        ids: [],
        notes: new Set(),
        people: new Set(),
        services: new Set(),
        rawNote: noteText,
      };
      a.workedMinutes += e.time_minutes;
      a.ids.push(e.id);
      if (noteText) a.notes.add(noteText);
      if (e.person_name) a.people.add(e.person_name);
      if (e.service_name) a.services.add(e.service_name);
      pmAgg.set(key, a);
    }
  }

  const items = [];

  for (const [key, agg] of jiraAgg) {
    const issue = issuesByKey.get(key);
    if (!issue) {
      console.warn(
        `⚠ JIRA key ${key} appears in Productive but wasn't pulled from JIRA — falling back to minimal record.`,
      );
    }
    items.push({
      source: "jira",
      jira_key: key,
      summary: issue?.summary ?? key,
      worked_minutes: agg.workedMinutes,
      estimated_seconds: issue?.estimate_seconds ?? null,
      jira_issuetype: issue?.issuetype ?? null,
      jira_status: issue?.status ?? null,
      jira_labels: issue?.labels ?? [],
      parent_key: issue?.parent_key ?? null,
      parent_summary: issue?.parent_summary ?? null,
      pm_notes: null,
      suggested_projects: suggestProjects(issue),
    });
  }

  for (const [, agg] of pmAgg) {
    const people = [...agg.people].join(", ");
    const services = [...agg.services].join(", ");
    const notes = [...agg.notes].join(" | ");
    const summary = notes
      ? notes.length > 120
        ? notes.slice(0, 117) + "…"
        : notes
      : `PM · ${services}${people ? ` (${people})` : ""}`;
    items.push({
      source: "project_management",
      jira_key: null,
      summary,
      worked_minutes: agg.workedMinutes,
      estimated_seconds: null,
      jira_issuetype: null,
      jira_status: null,
      jira_labels: [],
      parent_key: null,
      parent_summary: null,
      pm_notes: [
        notes ? `Note: ${notes}` : null,
        services ? `Service: ${services}` : null,
        people ? `People: ${people}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      suggested_projects: [],
    });
  }

  // Sort items by worked time desc for nicer default ordering.
  items.sort((a, b) => b.worked_minutes - a.worked_minutes);

  const report = {
    label: labelFromPeriod(periodStart),
    period_start: periodStart,
    period_end: periodEnd,
    productive_deal_id: pe.deal_id ?? null,
    productive_budget_name: budgetName ?? null,
    items,
  };

  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  const totalMin = items.reduce((s, i) => s + i.worked_minutes, 0);
  console.log(
    `Wrote ${outFile} — ${items.length} items, ${(totalMin / 60).toFixed(1)} h`,
  );
}

main();
