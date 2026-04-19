import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { minutesToHours } from "@/lib/format";
import { getJiraBaseUrl } from "@/lib/jira";
import { reopenReview, saveReviewerNote, signOff } from "./actions";
import { ReviewItems } from "./ReviewItems";
import { PendingButton } from "@/components/PendingButton";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const report = await prisma.report.findUnique({
    where: { magicToken: token },
    include: {
      items: {
        where: { internal: false },
        orderBy: [{ workedMinutes: "desc" }],
        include: { assignments: true },
      },
    },
  });
  if (!report) notFound();

  // Bump status from `sent` → `under_review` on first visit (lazy).
  if (report.status === "sent") {
    await prisma.report.update({
      where: { id: report.id },
      data: { status: "under_review" },
    });
    report.status = "under_review";
  }

  const projects = await prisma.project.findMany({ orderBy: { sortOrder: "asc" } });
  const locked = report.status === "approved" || report.status === "rejected";
  const totalMinutes = report.items.reduce((s, i) => s + i.workedMinutes, 0);
  const jiraBaseUrl = getJiraBaseUrl();

  // Invoice preview, even-split.
  const buckets: Record<string, number> = { Unassigned: 0 };
  for (const p of projects) buckets[p.name] = 0;
  for (const it of report.items) {
    if (it.assignments.length === 0) {
      buckets.Unassigned += it.workedMinutes;
    } else {
      const share = it.workedMinutes / it.assignments.length;
      for (const a of it.assignments) {
        const p = projects.find((x) => x.id === a.projectId);
        if (p) buckets[p.name] += share;
      }
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="bg-white border-b border-neutral-200">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold">Stock invoicing — {report.label}</h1>
              <p className="text-sm text-neutral-600">
                {report.periodStart.toISOString().slice(0, 10)} →{" "}
                {report.periodEnd.toISOString().slice(0, 10)} · {report.items.length} items ·{" "}
                {minutesToHours(totalMinutes)} h
              </p>
            </div>
            <StatusBadge status={report.status} />
          </div>
          {locked && (
            <p className="mt-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              This report has been {report.status}. It's now read-only.
            </p>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-8">
        <InvoiceOverview buckets={buckets} totalMinutes={totalMinutes} />

        <ReviewItems
          items={report.items}
          projects={projects}
          token={token}
          locked={locked}
          jiraBaseUrl={jiraBaseUrl}
        />

        {!locked && (
          <section className="bg-white border border-neutral-200 rounded-lg p-5 space-y-4">
            <h2 className="text-lg font-semibold">Overall note for PORTA (optional)</h2>
            <form action={saveReviewerNote} className="space-y-3">
              <input type="hidden" name="token" value={token} />
              <textarea
                name="note"
                defaultValue={report.reviewerNote ?? ""}
                rows={4}
                className="w-full border border-neutral-300 rounded px-3 py-2 text-sm"
                placeholder="Any overall comment for the whole report…"
              />
              <PendingButton
                className="bg-neutral-900 text-white rounded px-3 py-1.5 text-sm hover:bg-neutral-800"
                pendingLabel="Saving…"
              >
                Save note
              </PendingButton>
            </form>
          </section>
        )}

        <section className="bg-white border border-neutral-200 rounded-lg p-5 space-y-3">
          <h2 className="text-lg font-semibold">Sign off</h2>
          {locked ? (
            <div className="space-y-3">
              <p className="text-sm">
                You have {report.status} this report on{" "}
                {report.reviewedAt?.toLocaleString() ?? "—"}.
              </p>
              <form action={reopenReview}>
                <input type="hidden" name="token" value={token} />
                <PendingButton
                  className="border border-neutral-300 rounded px-3 py-1.5 text-sm hover:bg-neutral-50"
                  pendingLabel="Reopening…"
                >
                  Reopen for review
                </PendingButton>
                <p className="text-xs text-neutral-500 mt-1.5">
                  Undo your sign-off and continue editing. Your item decisions are kept.
                </p>
              </form>
            </div>
          ) : (
            <div className="flex flex-wrap gap-3">
              <form action={signOff}>
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="decision" value="approved" />
                <PendingButton
                  className="bg-green-600 text-white rounded px-4 py-2 text-sm hover:bg-green-700"
                  pendingLabel="Approving…"
                >
                  Approve report
                </PendingButton>
              </form>
              <form action={signOff}>
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="decision" value="rejected" />
                <PendingButton
                  className="bg-red-600 text-white rounded px-4 py-2 text-sm hover:bg-red-700"
                  pendingLabel="Rejecting…"
                >
                  Reject report
                </PendingButton>
              </form>
              <p className="text-xs text-neutral-500 self-center">
                After sign-off the report is locked.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function InvoiceOverview({
  buckets,
  totalMinutes,
}: {
  buckets: Record<string, number>;
  totalMinutes: number;
}) {
  return (
    <section className="sticky top-2 z-10 bg-white/95 backdrop-blur border border-neutral-200 rounded-lg p-5 shadow-sm">
      <h2 className="text-lg font-semibold mb-3">Invoice overview</h2>
      <p className="text-sm text-neutral-600 mb-3">
        Hours per project based on current assignments. Items assigned to multiple projects
        are split evenly.
      </p>
      <table className="w-full text-sm">
        <tbody>
          {Object.entries(buckets).map(([name, mins]) => (
            <tr key={name} className="border-t border-neutral-100 first:border-t-0">
              <td className="py-2 text-neutral-700">{name}</td>
              <td className="py-2 text-right font-medium">{minutesToHours(mins)} h</td>
            </tr>
          ))}
          <tr className="border-t-2 border-neutral-200">
            <td className="py-2 font-semibold">Total</td>
            <td className="py-2 text-right font-semibold">{minutesToHours(totalMinutes)} h</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft: "bg-neutral-100 text-neutral-700",
    sent: "bg-blue-50 text-blue-700",
    under_review: "bg-amber-50 text-amber-700",
    approved: "bg-green-50 text-green-700",
    rejected: "bg-red-50 text-red-700",
  };
  return (
    <span
      className={`rounded px-2 py-1 text-xs font-medium ${styles[status] ?? "bg-neutral-100"}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}
