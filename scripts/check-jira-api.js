#!/usr/bin/env node
/**
 * Smoke test for the JIRA REST client used by the "Refresh JIRA statuses"
 * admin button. Mirrors web/src/lib/jira.ts so a green run here means the
 * Vercel button will work too.
 *
 * Usage:  node scripts/check-jira-api.js [KEY1 KEY2 ...]
 *
 * Reads JIRA_BASE_URL, JIRA_API_EMAIL, JIRA_API_TOKEN from .env at repo root.
 */

const fs = require("node:fs");
const path = require("node:path");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
loadEnv();

const baseUrl = (process.env.JIRA_BASE_URL || "").trim().replace(/\/+$/, "");
const email = (process.env.JIRA_API_EMAIL || "").trim();
const token = (process.env.JIRA_API_TOKEN || "").trim();

if (!baseUrl || !email || !token) {
  console.error("Missing JIRA_BASE_URL, JIRA_API_EMAIL, or JIRA_API_TOKEN in .env");
  process.exit(1);
}
const authHeader = "Basic " + Buffer.from(`${email}:${token}`).toString("base64");

async function main() {
  // Scoped API tokens must call api.atlassian.com/ex/jira/{cloudId}/... —
  // the site URL silently returns empty results otherwise. Resolve cloudId
  // from the site's tenant_info endpoint first.
  console.log(`→ GET ${baseUrl}/_edge/tenant_info`);
  const tenant = await fetch(`${baseUrl}/_edge/tenant_info`);
  if (!tenant.ok) {
    console.error(`  ✗ ${tenant.status} ${tenant.statusText}`);
    process.exit(1);
  }
  const cloudId = (await tenant.json()).cloudId;
  console.log(`  ✓ cloudId=${cloudId}`);
  const apiBase = `https://api.atlassian.com/ex/jira/${cloudId}`;

  const keys = process.argv.slice(2);
  if (keys.length === 0) {
    console.log("\nNo keys passed; skipping JQL search. Pass keys to test the search path:");
    console.log("  node scripts/check-jira-api.js PCM2-91 SAPS-1");
    return;
  }

  const jql = `key in (${keys.join(",")})`;
  console.log(`\n→ POST ${apiBase}/rest/api/3/search/jql  jql="${jql}"`);
  const res = await fetch(`${apiBase}/rest/api/3/search/jql`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jql, fields: ["status"], maxResults: 100 }),
  });
  if (!res.ok) {
    console.error(`  ✗ ${res.status} ${res.statusText}`);
    console.error(`  ${await res.text()}`);
    process.exit(1);
  }
  const body = await res.json();
  console.log(`  ✓ ${res.status}; returned ${body.issues?.length ?? 0} issue(s)`);
  for (const issue of body.issues ?? []) {
    const name = issue.fields?.status?.name ?? "(no status)";
    console.log(`    ${issue.key.padEnd(14)} → ${name}`);
  }
  const found = new Set((body.issues ?? []).map((i) => i.key));
  const missing = keys.filter((k) => !found.has(k));
  if (missing.length > 0) {
    console.log(`  (not in JIRA: ${missing.join(", ")})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
