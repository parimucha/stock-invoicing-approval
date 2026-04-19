import { Fragment } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { minutesToHours, secondsToHours, diffHours } from "@/lib/format";
import { getJiraBaseUrl } from "@/lib/jira";
import { BudgetBar } from "@/components/BudgetBar";
import { JiraLink } from "@/components/JiraLink";
import { PendingButton } from "@/components/PendingButton";
import { mergeItems, updateItemSummary } from "./actions";

async function markSent(formData: FormData) {
  "use server";
  const id = Number(formData.get("id"));
  await prisma.report.update({
    where: { id },
    data: { status: "sent", sentAt: new Date() },
  });
  redirect(`/admin/reports/${id}`);
}

async function reopen(formData: FormData) {
  "use server";
  const id = Number(formData.get("id"));
  await prisma.report.update({
    where: { id },
    data: { status: "draft", sentAt: null, reviewedAt: null },
  });
  redirect(`/admin/reports/${id}`);
}

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const reportId = Number(id);
  if (Number.isNaN(reportId)) notFound();

  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: {
      items: {
        orderBy: { workedMinutes: "desc" },
        include: { assignments: { include: { project: true } } },
      },
    },
  });
  if (!report) notFound();

  const projects = await prisma.project.findMany({ orderBy: { sortOrder: "asc" } });
  const jiraBaseUrl = getJiraBaseUrl();
  const editable = report.status === "draft";
  const mergeTargets = report.items.map((it) => ({
    id: it.id,
    label: it.jiraKey ? `${it.jiraKey} — ${truncate(it.summary, 70)}` : `PM — ${truncate(it.summary, 70)}`,
    isJira: Boolean(it.jiraKey),
  }));

  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const magicUrl = `${proto}://${host}/review/${report.magicToken}`;

  const totalMinutes = report.items.reduce((s, i) => s + i.workedMinutes, 0);

  // Per-project preview (even-split of worked time)
  const buckets: Record<string, number> = { Unassigned: 0 };
  for (const p of projects) buckets[p.name] = 0;
  for (const it of report.items) {
    if (it.assignments.length === 0) {
      buckets.Unassigned += it.workedMinutes;
    } else {
      const share = it.workedMinutes / it.assignments.length;
      for (const a of it.assignments) buckets[a.project.name] += share;
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Report {report.label}</h1>
          <p className="text-sm text-neutral-600">
            {report.periodStart.toISOString().slice(0, 10)} →{" "}
            {report.periodEnd.toISOString().slice(0, 10)} ·{" "}
            <span className="capitalize">{report.status.replace("_", " ")}</span> ·{" "}
            {report.items.length} items · {minutesToHours(totalMinutes)} h total
          </p>
          {report.productiveBudgetName && (
            <p className="text-xs text-neutral-500 mt-1">
              Budget: {report.productiveBudgetName}
            </p>
          )}
        </div>
        <Link href="/admin" className="text-sm text-neutral-600 underline">
          ← Back
        </Link>
      </div>

      <section className="bg-white border border-neutral-200 rounded-lg p-4 space-y-3">
        <div>
          <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
            Magic link for Stock reviewer
          </div>
          <code className="block text-xs mt-1 break-all bg-neutral-50 border border-neutral-200 rounded px-2 py-1">
            {magicUrl}
          </code>
        </div>
        <div className="flex gap-2">
          {report.status === "draft" && (
            <form action={markSent}>
              <input type="hidden" name="id" value={report.id} />
              <PendingButton
                className="bg-neutral-900 text-white rounded px-3 py-1.5 text-sm hover:bg-neutral-800"
                pendingLabel="Marking…"
              >
                Mark as sent
              </PendingButton>
            </form>
          )}
          {report.status !== "draft" && (
            <form action={reopen}>
              <input type="hidden" name="id" value={report.id} />
              <PendingButton
                className="border border-neutral-300 rounded px-3 py-1.5 text-sm hover:bg-neutral-50"
                pendingLabel="Reopening…"
              >
                Reopen as draft
              </PendingButton>
            </form>
          )}
        </div>
      </section>

      <section className="bg-white border border-neutral-200 rounded-lg p-4">
        <h2 className="text-sm font-semibold mb-2">Invoice preview (current assignments)</h2>
        <table className="w-full text-sm">
          <tbody>
            {Object.entries(buckets).map(([name, mins]) => (
              <tr key={name} className="border-t border-neutral-100 first:border-t-0">
                <td className="py-1.5 text-neutral-700">{name}</td>
                <td className="py-1.5 text-right font-medium">{minutesToHours(mins)} h</td>
              </tr>
            ))}
            <tr className="border-t-2 border-neutral-200">
              <td className="py-1.5 font-semibold">Total</td>
              <td className="py-1.5 text-right font-semibold">
                {minutesToHours(totalMinutes)} h
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-neutral-600">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Key</th>
              <th className="text-left px-3 py-2 font-medium">Type</th>
              <th className="text-left px-3 py-2 font-medium">Summary</th>
              <th className="text-right px-3 py-2 font-medium">Worked</th>
              <th className="text-right px-3 py-2 font-medium">Est.</th>
              <th className="text-right px-3 py-2 font-medium">Δ</th>
              <th className="text-left px-3 py-2 font-medium">Projects</th>
              <th className="text-left px-3 py-2 font-medium">Approval</th>
              {editable && <th className="text-left px-3 py-2 font-medium">Edit</th>}
            </tr>
          </thead>
          <tbody>
            {report.items.map((it) => {
              const canEdit = editable && it.source === "project_management";
              return (
                <Fragment key={it.id}>
                  <tr className="border-t border-neutral-100 align-top">
                    <td className="px-3 py-2 font-mono text-xs">
                      {it.jiraKey ? (
                        <JiraLink
                          jiraKey={it.jiraKey}
                          jiraBaseUrl={jiraBaseUrl}
                          className="hover:underline"
                        />
                      ) : (
                        <span className="text-neutral-400">PM</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {it.jiraIssuetype && <IssueTypeBadge type={it.jiraIssuetype} />}
                    </td>
                    <td className="px-3 py-2">
                      <div>{it.summary}</div>
                      {it.parentSummary && (
                        <div className="text-xs text-neutral-500">
                          parent:{" "}
                          <JiraLink
                            jiraKey={it.parentKey}
                            jiraBaseUrl={jiraBaseUrl}
                            className="font-mono hover:underline"
                          />{" "}
                          {it.parentSummary}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div>{minutesToHours(it.workedMinutes)}</div>
                      <BudgetBar
                        workedMinutes={it.workedMinutes}
                        estimatedSeconds={it.estimatedSeconds}
                        className="mt-1 w-24 ml-auto"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">{secondsToHours(it.estimatedSeconds)}</td>
                    <td className="px-3 py-2 text-right">
                      {diffHours(it.estimatedSeconds, it.workedMinutes)}
                    </td>
                    <td className="px-3 py-2">
                      {it.assignments.length === 0 ? (
                        <span className="text-xs text-neutral-400">Unassigned</span>
                      ) : (
                        it.assignments.map((a) => a.project.name).join(", ")
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <ApprovalBadge approval={it.approval} />
                      {it.reviewerComment && (
                        <div className="text-xs text-neutral-500 italic mt-1">
                          “{it.reviewerComment}”
                        </div>
                      )}
                    </td>
                    {editable && (
                      <td className="px-3 py-2 align-top">
                        {canEdit && (
                          <details className="inline-block">
                            <summary className="cursor-pointer list-none select-none text-xs">
                              <span className="inline-block rounded border border-neutral-300 bg-white px-2 py-0.5 hover:bg-neutral-50">
                                Edit
                              </span>
                            </summary>
                          </details>
                        )}
                      </td>
                    )}
                  </tr>
                  {canEdit && (
                    <tr className="edit-row bg-neutral-50 border-t border-neutral-100">
                      <td colSpan={9} className="px-4 py-3">
                        <PmEditPanel
                          reportId={report.id}
                          itemId={it.id}
                          summary={it.summary}
                          targets={mergeTargets.filter((t) => t.id !== it.id)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </section>

      {report.reviewerNote && (
        <section className="bg-white border border-neutral-200 rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-1">Reviewer note</h2>
          <p className="text-sm whitespace-pre-wrap">{report.reviewerNote}</p>
        </section>
      )}
    </div>
  );
}

function IssueTypeBadge({ type }: { type: string }) {
  const lower = type.toLowerCase();
  const styles = lower.includes("bug")
    ? "bg-red-50 text-red-700"
    : lower.includes("sub")
      ? "bg-neutral-100 text-neutral-600"
      : lower.includes("scope")
        ? "bg-purple-50 text-purple-700"
        : "bg-blue-50 text-blue-700";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${styles}`}>
      {type}
    </span>
  );
}

type MergeTarget = { id: number; label: string; isJira: boolean };

function PmEditPanel({
  reportId,
  itemId,
  summary,
  targets,
}: {
  reportId: number;
  itemId: number;
  summary: string;
  targets: MergeTarget[];
}) {
  const jiraTargets = targets.filter((t) => t.isJira);
  const pmTargets = targets.filter((t) => !t.isJira);
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <form action={updateItemSummary} className="space-y-1.5">
        <input type="hidden" name="reportId" value={reportId} />
        <input type="hidden" name="itemId" value={itemId} />
        <label className="block text-xs font-medium text-neutral-600">Summary</label>
        <input
          name="summary"
          defaultValue={summary}
          required
          className="w-full text-sm border border-neutral-300 rounded px-2 py-1 bg-white"
        />
        <PendingButton
          className="text-xs border border-neutral-300 rounded px-2 py-1 hover:bg-white bg-white"
          pendingLabel="Saving…"
        >
          Save summary
        </PendingButton>
      </form>

      {targets.length > 0 && (
        <form action={mergeItems} className="space-y-1.5">
          <input type="hidden" name="reportId" value={reportId} />
          <input type="hidden" name="sourceId" value={itemId} />
          <label className="block text-xs font-medium text-neutral-600">Merge into…</label>
          <select
            name="targetId"
            required
            defaultValue=""
            className="w-full text-sm border border-neutral-300 rounded px-2 py-1 bg-white"
          >
            <option value="" disabled>
              Pick a target…
            </option>
            {jiraTargets.length > 0 && (
              <optgroup label="JIRA items">
                {jiraTargets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            )}
            {pmTargets.length > 0 && (
              <optgroup label="PM items">
                {pmTargets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <p className="text-xs text-neutral-500">
            Minutes sum into the target; this row&apos;s notes are appended and the row is removed.
          </p>
          <PendingButton
            className="text-xs border border-neutral-300 rounded px-2 py-1 hover:bg-white bg-white"
            pendingLabel="Merging…"
          >
            Merge
          </PendingButton>
        </form>
      )}
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

function ApprovalBadge({ approval }: { approval: string }) {
  const styles: Record<string, string> = {
    pending: "bg-neutral-100 text-neutral-600",
    approved: "bg-green-50 text-green-700",
    rejected: "bg-red-50 text-red-700",
  };
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
        styles[approval] ?? "bg-neutral-100"
      }`}
    >
      {approval}
    </span>
  );
}
