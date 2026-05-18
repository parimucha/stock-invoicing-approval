import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { formatCzk, minutesToCzk, minutesToHours } from "@/lib/format";
import { getJiraBaseUrl } from "@/lib/jira";
import { PendingButton } from "@/components/PendingButton";
import { ConfirmForm } from "@/components/ConfirmForm";
import { PmShareIndicator } from "@/components/PmShareIndicator";
import { ItemBreakdownCard } from "@/components/ItemBreakdownCard";
import { AdminItemsTable, type MergeTarget } from "./AdminItemsTable";
import { addItem, resetReport, updateHourlyRate } from "./actions";
import { RefreshTotalsButton } from "./RefreshTotalsButton";
import { RefreshStatusesButton } from "./RefreshStatusesButton";

async function markSent(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = Number(formData.get("id"));
  await prisma.report.update({
    where: { id },
    data: { status: "sent", sentAt: new Date() },
  });
  redirect(`/admin/reports/${id}`);
}

async function reopen(formData: FormData) {
  "use server";
  await requireAdmin();
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
  const internalMinutes = report.items.reduce(
    (s, i) => (i.internal ? s + i.workedMinutes : s),
    0,
  );
  // Invoiceable = only items the reviewer has explicitly approved. Pending
  // and rejected items are both excluded and shown separately so the admin
  // can see what's not yet billable at a glance. Internal items always come
  // out first (they're hidden from the client and can't be reviewed); the
  // categorization is internal → rejected → pending → approved so the math
  // is non-overlapping.
  const pendingItems = report.items.filter(
    (i) => !i.internal && i.approval === "pending",
  );
  const rejectedItems = report.items.filter(
    (i) => !i.internal && i.approval === "rejected",
  );
  const pendingMinutes = pendingItems.reduce((s, i) => s + i.workedMinutes, 0);
  const rejectedMinutes = rejectedItems.reduce((s, i) => s + i.workedMinutes, 0);
  const pmMinutes = report.items.reduce(
    (s, i) =>
      !i.internal && i.approval === "approved" && i.source === "project_management"
        ? s + i.workedMinutes
        : s,
    0,
  );

  // Per-project preview (even-split of worked time) — only approved items
  // contribute. Pending and rejected each get their own breakdown card.
  const buckets: Record<string, number> = { Unassigned: 0 };
  for (const p of projects) buckets[p.name] = 0;
  for (const it of report.items) {
    if (it.internal) continue;
    if (it.approval !== "approved") continue;
    if (it.assignments.length === 0) {
      buckets.Unassigned += it.workedMinutes;
    } else {
      const share = it.workedMinutes / it.assignments.length;
      for (const a of it.assignments) buckets[a.project.name] += share;
    }
  }
  const invoiceableMinutes =
    totalMinutes - internalMinutes - rejectedMinutes - pendingMinutes;
  const rate = report.hourlyRateCzk;
  const totalCost = minutesToCzk(totalMinutes, rate);
  const internalCost = minutesToCzk(internalMinutes, rate);
  const invoiceableCost = minutesToCzk(invoiceableMinutes, rate);

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
            {totalCost != null && <> · {formatCzk(totalCost)}</>}
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
          <ConfirmForm
            action={resetReport}
            confirmMessage="Reset all review state on this report? Status, approvals, reviewer comments, overall note, and project assignments will revert to the ingest-time defaults. Admin edits (summary renames, merges, PORTA notes) are kept."
            className="ml-auto"
          >
            <input type="hidden" name="id" value={report.id} />
            <PendingButton
              className="border border-red-300 text-red-700 rounded px-3 py-1.5 text-sm hover:bg-red-50"
              pendingLabel="Resetting…"
            >
              Reset report
            </PendingButton>
          </ConfirmForm>
        </div>
      </section>

      <section className="bg-white border border-neutral-200 rounded-lg p-4 space-y-4">
        <h2 className="text-sm font-semibold">Refresh from upstream</h2>
        <div>
          <h3 className="text-xs font-medium text-neutral-700 mb-1">Lifetime totals</h3>
          <p className="text-xs text-neutral-500 mb-2">
            Pulls each JIRA ticket's total worked time across all of Stock's
            history from Productive and updates the "h total" reference shown
            on every JIRA item. Safe to re-run — only that one field changes.
          </p>
          <RefreshTotalsButton reportId={report.id} />
        </div>
        <div className="pt-3 border-t border-neutral-100">
          <h3 className="text-xs font-medium text-neutral-700 mb-1">JIRA statuses</h3>
          <p className="text-xs text-neutral-500 mb-2">
            Pulls the current status of every JIRA-linked ticket from
            Atlassian and updates the status badge shown on each item. Safe
            to re-run — only that one field changes.
          </p>
          <RefreshStatusesButton reportId={report.id} />
        </div>
      </section>

      <section className="bg-white border border-neutral-200 rounded-lg p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold mb-1">Hourly rate</h2>
          <p className="text-xs text-neutral-500 mb-2">
            CZK per hour. Costs round up to whole crowns and appear next to every
            hours figure for this report. Leave blank to hide costs.
          </p>
          <form action={updateHourlyRate} className="flex items-center gap-2">
            <input type="hidden" name="reportId" value={report.id} />
            <input
              type="number"
              name="hourlyRateCzk"
              defaultValue={rate ?? ""}
              min={0}
              step={1}
              placeholder="e.g. 1500"
              className="text-sm border border-neutral-300 rounded px-2 py-1 w-32"
            />
            <span className="text-sm text-neutral-600">Kč / h</span>
            <PendingButton
              className="text-xs border border-neutral-300 rounded px-2 py-1 hover:bg-neutral-50"
              pendingLabel="Saving…"
            >
              Save rate
            </PendingButton>
          </form>
        </div>
      </section>

      <section className="bg-white border border-neutral-200 rounded-lg p-4">
        <h2 className="text-sm font-semibold mb-2">Invoice preview (current assignments)</h2>
        <p className="text-xs text-neutral-500 mb-2">
          Only items the client has explicitly <strong>approved</strong> count
          toward the invoice. Items still pending review, rejected by the
          client, or marked internal are listed separately and don&apos;t
          contribute to the total.
        </p>
        <table className="w-full text-sm">
          <tbody>
            {Object.entries(buckets).map(([name, mins]) => (
              <tr key={name} className="border-t border-neutral-100 first:border-t-0">
                <td className="py-1.5 text-neutral-700">{name}</td>
                <td className="py-1.5 text-right font-medium">{minutesToHours(mins)} h</td>
                {rate != null && (
                  <td className="py-1.5 text-right font-medium text-neutral-600 w-28">
                    {formatCzk(minutesToCzk(mins, rate))}
                  </td>
                )}
              </tr>
            ))}
            <tr className="border-t-2 border-neutral-200">
              <td className="py-1.5 font-semibold">Invoiceable total</td>
              <td className="py-1.5 text-right font-semibold">
                {minutesToHours(invoiceableMinutes)} h
              </td>
              {rate != null && (
                <td className="py-1.5 text-right font-semibold w-28">
                  {formatCzk(invoiceableCost)}
                </td>
              )}
            </tr>
            {pendingMinutes > 0 && (
              <tr className="border-t border-neutral-100 text-amber-700">
                <td className="py-1.5">Pending client review</td>
                <td className="py-1.5 text-right">{minutesToHours(pendingMinutes)} h</td>
                {rate != null && (
                  <td className="py-1.5 text-right w-28">
                    {formatCzk(minutesToCzk(pendingMinutes, rate))}
                  </td>
                )}
              </tr>
            )}
            {rejectedMinutes > 0 && (
              <tr className="border-t border-neutral-100 text-red-700">
                <td className="py-1.5">Rejected by client</td>
                <td className="py-1.5 text-right">{minutesToHours(rejectedMinutes)} h</td>
                {rate != null && (
                  <td className="py-1.5 text-right w-28">
                    {formatCzk(minutesToCzk(rejectedMinutes, rate))}
                  </td>
                )}
              </tr>
            )}
            {internalMinutes > 0 && (
              <tr className="border-t border-neutral-100 text-neutral-500">
                <td className="py-1.5">Internal (hidden from client)</td>
                <td className="py-1.5 text-right">{minutesToHours(internalMinutes)} h</td>
                {rate != null && (
                  <td className="py-1.5 text-right w-28">
                    {formatCzk(internalCost)}
                  </td>
                )}
              </tr>
            )}
          </tbody>
        </table>
        <div className="mt-4 pt-3 border-t border-neutral-200">
          <PmShareIndicator
            pmMinutes={pmMinutes}
            invoiceableMinutes={invoiceableMinutes}
          />
        </div>
      </section>

      <ItemBreakdownCard
        title="Pending client review"
        tone="pending"
        helperText="Excluded from the invoice total above until the client approves them."
        items={pendingItems}
        hourlyRateCzk={rate}
        jiraBaseUrl={jiraBaseUrl}
      />

      <ItemBreakdownCard
        title="Rejected by client"
        tone="rejected"
        helperText="Excluded from the invoice total above. Listed here for visibility."
        items={rejectedItems}
        hourlyRateCzk={rate}
        jiraBaseUrl={jiraBaseUrl}
      />

      {editable && (
        <section className="bg-white border border-neutral-200 rounded-lg p-4">
          <details>
            <summary className="cursor-pointer text-sm font-semibold select-none">
              + Add item manually
            </summary>
            <form action={addItem} className="mt-4 space-y-3">
              <input type="hidden" name="reportId" value={report.id} />
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block text-xs font-medium text-neutral-600 md:col-span-2">
                  Summary
                  <input
                    name="summary"
                    required
                    className="mt-1 w-full text-sm border border-neutral-300 rounded px-2 py-1 font-normal"
                    placeholder="What was done…"
                  />
                </label>
                <label className="block text-xs font-medium text-neutral-600">
                  Hours worked
                  <input
                    name="hoursWorked"
                    type="number"
                    required
                    min={0}
                    step="0.25"
                    className="mt-1 w-full text-sm border border-neutral-300 rounded px-2 py-1 font-normal"
                    placeholder="e.g. 1.5"
                  />
                  <span className="block mt-1 text-[11px] font-normal text-neutral-500">
                    Decimal hours; rounds to whole minutes on save.
                  </span>
                </label>
                <label className="block text-xs font-medium text-neutral-600">
                  JIRA key (optional)
                  <input
                    name="jiraKey"
                    className="mt-1 w-full text-sm border border-neutral-300 rounded px-2 py-1 font-normal font-mono"
                    placeholder="PCM2-123"
                  />
                </label>
              </div>
              <label className="block text-xs font-medium text-neutral-600">
                PORTA notes (optional)
                <textarea
                  name="portaNotes"
                  rows={2}
                  className="mt-1 w-full text-sm border border-neutral-300 rounded px-2 py-1 font-normal"
                  placeholder="Context shown read-only to the reviewer…"
                />
              </label>
              <fieldset className="text-xs text-neutral-600">
                <legend className="font-medium">Suggested projects (optional)</legend>
                <div className="mt-1 flex flex-wrap gap-3">
                  {projects.map((p) => (
                    <label key={p.id} className="flex items-center gap-1 font-normal">
                      <input type="checkbox" name="projectIds" value={p.id} />
                      {p.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="flex items-center gap-2 text-xs text-neutral-600 font-medium">
                <input type="checkbox" name="internal" />
                Mark as internal (hidden from the client)
              </label>
              <PendingButton
                className="bg-neutral-900 text-white rounded px-3 py-1.5 text-sm hover:bg-neutral-800"
                pendingLabel="Adding…"
              >
                Add item
              </PendingButton>
            </form>
          </details>
        </section>
      )}

      <AdminItemsTable
        items={report.items}
        reportId={report.id}
        jiraBaseUrl={jiraBaseUrl}
        editable={editable}
        mergeTargets={mergeTargets}
        hourlyRateCzk={rate}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
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
