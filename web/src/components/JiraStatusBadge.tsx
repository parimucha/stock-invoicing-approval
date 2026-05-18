export function JiraStatusBadge({ status }: { status: string }) {
  const lower = status.toLowerCase();
  let styles = "bg-neutral-100 text-neutral-700 border border-neutral-200";
  if (/done|deployed|closed|resolved/.test(lower)) {
    styles = "bg-green-50 text-green-700 border border-green-200";
  } else if (/in progress|in review/.test(lower)) {
    styles = "bg-blue-50 text-blue-700 border border-blue-200";
  } else if (/verification|ready|to do|open|backlog/.test(lower)) {
    styles = "bg-amber-50 text-amber-800 border border-amber-200";
  } else if (/rejected|cancel|won't/.test(lower)) {
    styles = "bg-red-50 text-red-700 border border-red-200";
  }
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${styles}`}>
      {status}
    </span>
  );
}
