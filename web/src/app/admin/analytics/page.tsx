import { prisma } from "@/lib/prisma";
import { buildProjectTimeMatrix } from "@/lib/analytics";
import AnalyticsDashboard from "./AnalyticsDashboard";

export default async function AnalyticsPage() {
  const reports = await prisma.report.findMany({
    orderBy: { periodStart: "asc" },
    select: {
      id: true,
      label: true,
      items: {
        select: {
          workedMinutes: true,
          assignments: {
            select: { projectId: true, project: { select: { name: true } } },
          },
        },
      },
    },
  });

  const matrix = buildProjectTimeMatrix(reports);
  return <AnalyticsDashboard matrix={matrix} />;
}
