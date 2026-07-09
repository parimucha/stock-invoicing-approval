import { prisma } from "@/lib/prisma";
import { getJiraBaseUrl } from "@/lib/jira";
import {
  computeExportModel,
  DEFAULT_PRESET,
  toExportInput,
  type ExportPresetConfig,
} from "@/lib/invoice-export";
import { parseExportPresetConfig } from "@/lib/invoice-export-config";
import { renderWorkbook } from "@/lib/invoice-workbook";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const presetId = new URL(req.url).searchParams.get("preset");

  const report = await prisma.report.findUnique({
    where: { magicToken: token },
    include: {
      items: { where: { internal: false }, include: { assignments: true } },
    },
  });
  if (!report) return new Response("Not found", { status: 404 });
  // Preserve the Phase 1 review fix: the endpoint only serves approved reports.
  if (report.status !== "approved") {
    return new Response("Not found", { status: 404 });
  }

  let preset: ExportPresetConfig = DEFAULT_PRESET;
  if (presetId) {
    const row = await prisma.exportPreset.findUnique({ where: { id: presetId } });
    if (!row) return new Response("Preset not found", { status: 404 });
    try {
      preset = parseExportPresetConfig(row.config);
    } catch {
      return new Response("Invalid preset configuration", { status: 422 });
    }
  }

  const model = computeExportModel(toExportInput(report, getJiraBaseUrl()), preset);
  const workbook = renderWorkbook(model, preset);
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
