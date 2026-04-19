import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { minutesToHours } from "@/lib/format";
import { getJiraBaseUrl } from "@/lib/jira";
import { PendingButton } from "@/components/PendingButton";
import { AdminItemsTable, type MergeTarget } from "./AdminItemsTable";

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
  const mergeTargets: MergeTarget[] = report.items.map((it) => ({
    id: it.id,
    label: it.jiraKey
      ? `${it.jiraKey} — ${truncate(it.summary, 70)}`
      : `PM — ${truncate(it.summary, 70)}`,
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

      <AdminItemsTable
        items={report.items}
        reportId={report.id}
        jiraBaseUrl={jiraBaseUrl}
        editable={editable}
        mergeTargets={mergeTargets}
      />

      {report.reviewerNote && (
        <section className="bg-white border border-neutral-200 rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-1">Reviewer note</h2>
          <p className="text-sm whitespace-pre-wrap">{report.reviewerNote}</p>
        </section>
      )}
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}
