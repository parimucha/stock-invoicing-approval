import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { minutesToHours } from "@/lib/format";

export default async function AdminHome() {
  const reports = await prisma.report.findMany({
    orderBy: { label: "desc" },
    include: { _count: { select: { items: true } }, items: { select: { workedMinutes: true } } },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Reports</h1>
        <Link
          href="/admin/upload"
          className="bg-neutral-900 text-white rounded px-3 py-1.5 text-sm hover:bg-neutral-800"
        >
          New report
        </Link>
      </div>

      <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
        {reports.length === 0 ? (
          <p className="p-6 text-sm text-neutral-600">
            No reports yet. Upload one from the button above.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-600">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Month</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Items</th>
                <th className="text-left px-4 py-2 font-medium">Hours</th>
                <th className="text-left px-4 py-2 font-medium">Created</th>
                <th className="text-left px-4 py-2 font-medium">Sent</th>
                <th className="text-left px-4 py-2 font-medium">Reviewed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => {
                const total = r.items.reduce((s, i) => s + i.workedMinutes, 0);
                return (
                  <tr key={r.id} className="border-t border-neutral-100">
                    <td className="px-4 py-2 font-medium">{r.label}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-2">{r._count.items}</td>
                    <td className="px-4 py-2">{minutesToHours(total)} h</td>
                    <td className="px-4 py-2 text-neutral-600">
                      {r.createdAt.toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2 text-neutral-600">
                      {r.sentAt?.toLocaleDateString() ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-neutral-600">
                      {r.reviewedAt?.toLocaleDateString() ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link
                        href={`/admin/reports/${r.id}`}
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
        )}
      </div>
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
