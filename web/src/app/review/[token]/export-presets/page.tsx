import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getJiraBaseUrl } from "@/lib/jira";
import { toExportInput, type ExportPresetConfig } from "@/lib/invoice-export";
import { ExportPresetBuilder } from "./ExportPresetBuilder";

export default async function ExportPresetsPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const report = await prisma.report.findUnique({
    where: { magicToken: token },
    include: {
      items: { where: { internal: false }, include: { assignments: true } },
    },
  });
  if (!report) notFound();

  const [projects, presetRows] = await Promise.all([
    prisma.project.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.exportPreset.findMany({ orderBy: { name: "asc" } }),
  ]);

  const input = toExportInput(report, getJiraBaseUrl());
  const presets = presetRows.map((p) => ({
    id: p.id,
    name: p.name,
    config: p.config as unknown as ExportPresetConfig,
  }));

  return (
    <div className="min-h-screen bg-neutral-50">
      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <div>
          <a href={`/review/${token}`} className="text-sm text-neutral-500 hover:underline">
            ← Back to review
          </a>
          <h1 className="text-xl font-semibold mt-1">Export presets — {report.label}</h1>
          <p className="text-sm text-neutral-600">
            Configure a reusable Excel export. The preview uses this report&apos;s
            approved items. Download from the review page once saved.
          </p>
        </div>
        <ExportPresetBuilder
          token={token}
          input={input}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          presets={presets}
        />
      </main>
    </div>
  );
}
