import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

import { parseUploadReport } from "../src/lib/report-schema";

const prisma = new PrismaClient();

async function main() {
  const reportPath = process.argv[2];
  if (!reportPath) {
    console.error("Usage: tsx scripts/seed-report.ts <path-to-report.json>");
    process.exit(1);
  }
  const full = path.resolve(reportPath);
  const raw = fs.readFileSync(full, "utf8");
  const parsed = parseUploadReport(JSON.parse(raw));

  const existing = await prisma.report.findUnique({ where: { label: parsed.label } });
  if (existing) await prisma.report.delete({ where: { id: existing.id } });

  const created = await prisma.report.create({
    data: {
      label: parsed.label,
      periodStart: new Date(parsed.period_start),
      periodEnd: new Date(parsed.period_end),
      productiveDealId: parsed.productive_deal_id ?? null,
      productiveBudgetName: parsed.productive_budget_name ?? null,
      magicToken: randomBytes(24).toString("base64url"),
      status: "sent",
      sentAt: new Date(),
      items: {
        create: parsed.items.map((i) => ({
          source: i.source,
          jiraKey: i.jira_key,
          summary: i.summary,
          workedMinutes: i.worked_minutes,
          estimatedSeconds: i.estimated_seconds,
          jiraIssuetype: i.jira_issuetype,
          jiraStatus: i.jira_status,
          jiraLabels: i.jira_labels,
          parentKey: i.parent_key,
          parentSummary: i.parent_summary,
          pmNotes: i.pm_notes,
          suggestedProjects: i.suggested_projects,
          assignments: {
            create: i.suggested_projects.map((pid) => ({ projectId: pid })),
          },
        })),
      },
    },
  });

  console.log(`Seeded report ${parsed.label} (id=${created.id})`);
  console.log(`Magic link: http://localhost:3000/review/${created.magicToken}`);
  console.log(`Admin view: http://localhost:3000/admin/reports/${created.id}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
