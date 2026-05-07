/**
 * Minimal Productive API client for the "refresh lifetime totals" admin
 * action. Targeted by JIRA key so each refresh stays bounded — we don't pull
 * the full company time-entry history on the request thread.
 *
 * Note: this only matches entries where Productive's dedicated `jira_issue_id`
 * field is set. Entries where the JIRA key is mentioned only in the note text
 * (handled by the local pull-productive-totals.js script via regex) are NOT
 * counted here. For Stock that's a small minority; the local script remains
 * the canonical source if you need exact totals.
 */

const BASE_URL = "https://api.productive.io/api/v2";
const PAGE_SIZE = 200;
const CONCURRENCY = 8;

type Env = {
  token: string;
  orgId: string;
  companyId: string;
};

function readEnv(): Env {
  const token = process.env.PRODUCTIVE_API_TOKEN;
  const orgId = process.env.PRODUCTIVE_ORG_ID;
  const companyId = process.env.PRODUCTIVE_STOCK_COMPANY_ID;
  if (!token || !orgId || !companyId) {
    throw new Error(
      "Productive credentials are not configured. Set PRODUCTIVE_API_TOKEN, " +
        "PRODUCTIVE_ORG_ID, and PRODUCTIVE_STOCK_COMPANY_ID in the environment.",
    );
  }
  return { token, orgId, companyId };
}

async function fetchPage(env: Env, jiraKey: string, page: number) {
  const url = new URL(`${BASE_URL}/time_entries`);
  url.searchParams.set("filter[company_id]", env.companyId);
  url.searchParams.set("filter[jira_issue_id]", jiraKey);
  url.searchParams.set("fields[time_entries]", "time");
  url.searchParams.set("page[number]", String(page));
  url.searchParams.set("page[size]", String(PAGE_SIZE));

  const res = await fetch(url, {
    headers: {
      "X-Auth-Token": env.token,
      "X-Organization-Id": env.orgId,
      "Content-Type": "application/vnd.api+json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Productive ${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res.json() as Promise<{
    data: Array<{ attributes: { time?: number | null } }>;
    meta: { total_pages: number; total_count: number };
  }>;
}

async function totalForKey(env: Env, jiraKey: string): Promise<number> {
  let page = 1;
  let total = 0;
  while (true) {
    const body = await fetchPage(env, jiraKey, page);
    for (const entry of body.data) {
      total += Number(entry.attributes?.time ?? 0);
    }
    if (page >= body.meta.total_pages) break;
    page += 1;
  }
  return total;
}

/**
 * Returns lifetime worked-minutes per JIRA key for Stock's company. Keys
 * with no entries in Productive simply don't appear in the result map; the
 * caller should treat that as "no data to write" rather than zero.
 */
export async function fetchLifetimeMinutesForKeys(
  jiraKeys: string[],
): Promise<Map<string, number>> {
  const env = readEnv();
  const queue = [...new Set(jiraKeys)].filter(Boolean);
  const result = new Map<string, number>();

  const workers = Array.from(
    { length: Math.min(CONCURRENCY, queue.length) },
    async () => {
      while (queue.length > 0) {
        const key = queue.shift();
        if (!key) break;
        const minutes = await totalForKey(env, key);
        // 0 minutes still means "we asked Productive and found nothing" —
        // record it so the caller can distinguish from "didn't fetch".
        result.set(key, minutes);
      }
    },
  );
  await Promise.all(workers);
  return result;
}
