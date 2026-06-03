import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { serializeBackup } from "@/lib/report-backup";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const reportId = Number(id);
  if (Number.isNaN(reportId)) return new Response("Not found", { status: 404 });

  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: { items: { include: { assignments: true } } },
  });
  if (!report) return new Response("Not found", { status: 404 });

  const projectIds = new Set<string>();
  for (const it of report.items) {
    for (const p of (it.suggestedProjects as string[] | null) ?? []) projectIds.add(p);
    for (const a of it.assignments) projectIds.add(a.projectId);
  }
  const projects = await prisma.project.findMany({
    where: { id: { in: [...projectIds] } },
    orderBy: { sortOrder: "asc" },
  });

  const exportedAt = new Date().toISOString();
  const backup = serializeBackup({ report, projects }, exportedAt);
  const filename = `backup-${report.label}-${exportedAt.slice(0, 10)}.json`;

  return new Response(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
