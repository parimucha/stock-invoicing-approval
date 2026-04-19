import type { ReactNode } from "react";
import { jiraIssueUrl } from "@/lib/jira";

type Props = {
  jiraKey: string | null | undefined;
  jiraBaseUrl: string | null;
  className?: string;
  title?: string;
  children?: ReactNode;
};

export function JiraLink({
  jiraKey,
  jiraBaseUrl,
  className,
  title,
  children,
}: Props) {
  if (!jiraKey) return null;
  const url = jiraIssueUrl(jiraBaseUrl, jiraKey);
  const label = children ?? jiraKey;
  if (!url) {
    return <span className={className}>{label}</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      title={title ?? "Open in JIRA"}
    >
      {label}
    </a>
  );
}
