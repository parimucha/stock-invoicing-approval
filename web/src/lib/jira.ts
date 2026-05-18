export function getJiraBaseUrl(): string | null {
  const raw = process.env.JIRA_BASE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

export function jiraIssueUrl(
  base: string | null,
  key: string | null | undefined,
): string | null {
  if (!base || !key) return null;
  return `${base.replace(/\/+$/, "")}/browse/${key}`;
}

/**
 * Minimal Atlassian Cloud REST API client for the "refresh JIRA statuses"
 * admin action. Batches JQL queries by key so each refresh hits the API a
 * handful of times rather than once per ticket.
 *
 * Uses POST /rest/api/3/search/jql (the replacement for the deprecated
 * /search endpoint, cursor-paginated via nextPageToken). Auth is HTTP Basic
 * with email + API token.
 */

// JQL `key in (...)` has a hard length limit (~8 KB); 50 keys fits with room
// to spare even for long prefixes like `STOCK-123456`.
const JQL_BATCH_SIZE = 50;
const SEARCH_PAGE_SIZE = 100;

type JiraEnv = {
  siteUrl: string;
  authHeader: string;
};

function readJiraEnv(): JiraEnv {
  const siteUrl = getJiraBaseUrl();
  const email = process.env.JIRA_API_EMAIL?.trim();
  const token = process.env.JIRA_API_TOKEN?.trim();
  if (!siteUrl || !email || !token) {
    throw new Error(
      "JIRA credentials are not configured. Set JIRA_BASE_URL, JIRA_API_EMAIL, " +
        "and JIRA_API_TOKEN in the environment.",
    );
  }
  const authHeader =
    "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
  return { siteUrl, authHeader };
}

// Scoped API tokens (with explicit scopes like read:jira-work) must call
// Jira via api.atlassian.com/ex/jira/{cloudId}/... — the site URL works for
// classic unscoped tokens but silently returns empty results for scoped
// tokens. Look up the cloudId once per process from the site's tenant_info
// endpoint and cache it.
let cloudIdPromise: Promise<string> | null = null;

function resolveCloudId(siteUrl: string): Promise<string> {
  if (cloudIdPromise) return cloudIdPromise;
  cloudIdPromise = (async () => {
    const res = await fetch(`${siteUrl}/_edge/tenant_info`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(
        `Could not resolve cloudId from ${siteUrl}/_edge/tenant_info: ${res.status} ${res.statusText}`,
      );
    }
    const body = (await res.json()) as { cloudId?: string };
    if (!body.cloudId) {
      throw new Error(`tenant_info response missing cloudId: ${JSON.stringify(body)}`);
    }
    return body.cloudId;
  })().catch((err) => {
    // Don't pin a failed lookup in cache — next call should retry.
    cloudIdPromise = null;
    throw err;
  });
  return cloudIdPromise;
}

type SearchResponse = {
  issues?: Array<{ key: string; fields?: { status?: { name?: string } | null } }>;
  nextPageToken?: string;
  isLast?: boolean;
};

async function searchPage(
  apiBase: string,
  authHeader: string,
  jql: string,
  nextPageToken: string | undefined,
): Promise<SearchResponse> {
  const body: Record<string, unknown> = {
    jql,
    fields: ["status"],
    maxResults: SEARCH_PAGE_SIZE,
  };
  if (nextPageToken) body.nextPageToken = nextPageToken;

  const res = await fetch(`${apiBase}/rest/api/3/search/jql`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`JIRA ${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return (await res.json()) as SearchResponse;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Returns the current JIRA status name per key. Keys that the API doesn't
 * return (deleted, renamed, typo) simply don't appear in the result map;
 * the caller should treat that as "not found" rather than "blank status".
 */
export async function fetchJiraStatusesForKeys(
  jiraKeys: string[],
): Promise<Map<string, string>> {
  const env = readJiraEnv();
  const cloudId = await resolveCloudId(env.siteUrl);
  const apiBase = `https://api.atlassian.com/ex/jira/${cloudId}`;
  const unique = [...new Set(jiraKeys)].filter(Boolean);
  const result = new Map<string, string>();

  for (const batch of chunk(unique, JQL_BATCH_SIZE)) {
    const jql = `key in (${batch.join(",")})`;
    let nextPageToken: string | undefined;
    while (true) {
      const page = await searchPage(apiBase, env.authHeader, jql, nextPageToken);
      for (const issue of page.issues ?? []) {
        const name = issue.fields?.status?.name;
        if (issue.key && name) result.set(issue.key, name);
      }
      if (page.isLast || !page.nextPageToken) break;
      nextPageToken = page.nextPageToken;
    }
  }
  return result;
}
