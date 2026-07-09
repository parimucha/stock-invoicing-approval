import { prisma } from "@/lib/prisma";
import { getJiraBaseUrl } from "@/lib/jira";
import { computeExportModel, DEFAULT_PRESET } from "@/lib/invoice-export";
import { renderWorkbook } from "@/lib/invoice-workbook";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const report = await prisma.report.findUnique({
    where: { magicToken: token },
    include: {
      items: {
        where: { internal: false },
        include: { assignments: true },
      },
    },
  });
  if (!report) return new Response("Not found", { status: 404 });
  if (report.status !== "approved") {
    return new Response("Not found", { status: 404 });
  }

  const model = computeExportModel(
    {
      report: {
        label: report.label,
        periodStart: report.periodStart,
        hourlyRateCzk: report.hourlyRateCzk,
      },
      items: report.items.map((it) => ({
        jiraKey: it.jiraKey,
        summary: it.summary,
        workedMinutes: it.workedMinutes,
        estimatedSeconds: it.estimatedSeconds,
        jiraStatus: it.jiraStatus,
        parentKey: it.parentKey,
        parentSummary: it.parentSummary,
        portaNotes: it.portaNotes,
        reviewerComment: it.reviewerComment,
        approval: it.approval,
        assignedProjectIds: it.assignments.map((a) => a.projectId),
      })),
      jiraBaseUrl: getJiraBaseUrl(),
    },
    DEFAULT_PRESET,
  );

  const workbook = renderWorkbook(model, DEFAULT_PRESET);
  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `invoice-${report.label}.xlsx`;

  return new Response(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
