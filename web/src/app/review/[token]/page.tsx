import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { minutesToHours } from "@/lib/format";
import { getJiraBaseUrl } from "@/lib/jira";
import { reopenReview, saveReviewerNote, signOff } from "./actions";
import { ReviewItems } from "./ReviewItems";
import { PendingButton } from "@/components/PendingButton";
import { HelpButton } from "@/components/HelpButton";

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
            <div className="flex items-center gap-3">
              <HelpButton title="How to review this report">
                <ReviewHelpContent />
              </HelpButton>
              <StatusBadge status={report.status} />
            </div>
          </div>
          {locked && (
            <p className="mt-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              This report has been {report.status}. It's now read-only.
            </p>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-8">
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

function ReviewHelpContent() {
  return (
    <>
      <section>
        <h3 className="font-semibold mb-1">What this is</h3>
        <p>
          PORTA prepared this report with all the work done on your account last
          month. You review each item — approve what&apos;s correct, adjust the
          project assignment when needed, and sign off when you&apos;re ready.
          PORTA invoices based on your approval.
        </p>
      </section>

      <section>
        <h3 className="font-semibold mb-1">Invoice overview (top bar)</h3>
        <p>
          Per-project totals based on current assignments. Items assigned to
          multiple projects are split evenly across them.{" "}
          <strong>PM share</strong> shows how much of the invoiceable time was
          project management — it must stay within the 20% cap (green / red
          indicator). The bar collapses to a one-line summary as you scroll and
          re-expands at the top.
        </p>
      </section>

      <section>
        <h3 className="font-semibold mb-1">Item cards</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            The code at the top (e.g.{" "}
            <code className="bg-neutral-100 px-1 rounded">PCM2-184</code>) is the
            JIRA ticket — click it to open. Items tagged <strong>PM</strong> are
            project-management work with no ticket.
          </li>
          <li>
            The green/red bar next to the hours compares worked time against the
            JIRA estimate. Red means time went over the estimate.
          </li>
          <li>
            A blue <strong>Note from PORTA</strong> box means PORTA added
            context for this item — read only.
          </li>
          <li>
            <strong>Projects</strong> — tick the project(s) this item should
            bill to. Multiple ticks split the hours evenly.
          </li>
          <li>
            <strong>Approve / Reject / Pending</strong> — your decision per
            item, with an optional comment for PORTA.
          </li>
        </ul>
        <p className="mt-2 text-neutral-600">
          Everything saves automatically as you click or type.
        </p>
      </section>

      <section>
        <h3 className="font-semibold mb-1">Filter and sort</h3>
        <p>
          Above the items: search by key / summary / label, filter by approval
          status or source (JIRA / PM), and sort by worked hours, over- or
          under-budget, or JIRA key.
        </p>
      </section>

      <section>
        <h3 className="font-semibold mb-1">Sign off</h3>
        <p>
          When you&apos;re done, hit <strong>Approve report</strong> or{" "}
          <strong>Reject report</strong> at the bottom. The report locks. If
          you change your mind, click <strong>Reopen for review</strong> in the
          same section to unlock and edit again.
        </p>
      </section>

      <section>
        <h3 className="font-semibold mb-1">Questions?</h3>
        <p>
          Leave an <strong>Overall note for PORTA</strong> (above the sign-off
          buttons) for anything that doesn&apos;t fit a specific item — or
          reach out to PORTA directly.
        </p>
      </section>
    </>
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
