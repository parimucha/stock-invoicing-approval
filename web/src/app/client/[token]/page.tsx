import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatCzk, minutesToCzk, minutesToHours } from "@/lib/format";

// Client-facing dashboard. Lists every non-draft report with status,
// totals, and a link to that report's per-report magic-link review page.
// Magic token in the URL is the only credential — keep it private; anyone
// with the link sees every report.
export default async function ClientDashboard({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const client = await prisma.client.findUnique({ where: { magicToken: token } });
  if (!client) notFound();

  const reports = await prisma.report.findMany({
    where: { status: { not: "draft" } },
    orderBy: { label: "desc" },
    include: {
      items: {
        // Pull approval + minutes only — we render approved/pending/rejected
        // hour totals per row and don't need the rest of the item payload.
        where: { internal: false },
        select: { approval: true, workedMinutes: true },
      },
    },
  });

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="bg-white border-b border-neutral-200">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{client.name} reports</h1>
            <p className="text-sm text-neutral-600">
              {reports.length} report{reports.length === 1 ? "" : "s"} from PORTA.
              Click into any to review, approve, or revisit.
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-6">
        {reports.length === 0 ? (
          <div className="bg-white border border-neutral-200 rounded-lg p-8 text-center text-sm text-neutral-500">
            No reports yet. PORTA sends one per month — your link will start
            populating as soon as the first report is sent.
          </div>
        ) : (
          <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-neutral-600">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Period</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-right px-4 py-2 font-medium">Approved</th>
                  <th className="text-right px-4 py-2 font-medium">Pending</th>
                  <th className="text-right px-4 py-2 font-medium">Rejected</th>
                  <th className="text-right px-4 py-2 font-medium">Invoiced</th>
                  <th className="text-left px-4 py-2 font-medium">Sent</th>
                  <th className="text-left px-4 py-2 font-medium">Reviewed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => {
                  const approvedMin = r.items.reduce(
                    (s, i) => (i.approval === "approved" ? s + i.workedMinutes : s),
                    0,
                  );
                  const pendingMin = r.items.reduce(
                    (s, i) => (i.approval === "pending" ? s + i.workedMinutes : s),
                    0,
                  );
                  const rejectedMin = r.items.reduce(
                    (s, i) => (i.approval === "rejected" ? s + i.workedMinutes : s),
                    0,
                  );
                  const approvedCost = minutesToCzk(approvedMin, r.hourlyRateCzk);
                  return (
                    <tr key={r.id} className="border-t border-neutral-100">
                      <td className="px-4 py-2 font-medium">{r.label}</td>
                      <td className="px-4 py-2">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-4 py-2 text-right text-neutral-700">
                        {minutesToHours(approvedMin)} h
                      </td>
                      <td className="px-4 py-2 text-right text-neutral-700">
                        {pendingMin > 0 ? (
                          <span className="text-amber-700">
                            {minutesToHours(pendingMin)} h
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-2 text-right text-neutral-700">
                        {rejectedMin > 0 ? (
                          <span className="text-red-700">
                            {minutesToHours(rejectedMin)} h
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-2 text-right text-neutral-600">
                        {approvedCost != null ? formatCzk(approvedCost) : "—"}
                      </td>
                      <td className="px-4 py-2 text-neutral-600">
                        {r.sentAt?.toLocaleDateString() ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-neutral-600">
                        {r.reviewedAt?.toLocaleDateString() ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Link
                          href={`/review/${r.magicToken}`}
                          className="text-neutral-900 underline underline-offset-2 hover:no-underline"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
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
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
        styles[status] ?? "bg-neutral-100"
      }`}
    >
      {status.replace("_", " ")}
    </span>
  );
}
