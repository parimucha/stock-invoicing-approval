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
