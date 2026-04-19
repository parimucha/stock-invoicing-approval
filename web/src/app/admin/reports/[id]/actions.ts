"use server";

import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

async function loadDraftReport(reportId: number) {
  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) notFound();
  if (report.status !== "draft") {
    throw new Error(
      `Report is not editable in status "${report.status}". Reopen as draft first.`,
    );
  }
  return report;
}

function joinNotes(...parts: Array<string | null | undefined>): string | null {
  const trimmed = parts
    .map((p) => (p ?? "").trim())
    .filter((p) => p.length > 0);
  if (trimmed.length === 0) return null;
  return trimmed.join("\n\n");
}

export async function mergeItems(formData: FormData) {
  const reportId = Number(formData.get("reportId"));
  const sourceId = Number(formData.get("sourceId"));
  const targetId = Number(formData.get("targetId"));
  if (!reportId || !sourceId || !targetId) throw new Error("Missing ids.");
  if (sourceId === targetId) throw new Error("Cannot merge an item into itself.");

  const report = await loadDraftReport(reportId);

  const [source, target] = await Promise.all([
    prisma.reportItem.findUnique({ where: { id: sourceId } }),
    prisma.reportItem.findUnique({ where: { id: targetId } }),
  ]);
  if (!source || !target) notFound();
  if (source.reportId !== report.id || target.reportId !== report.id) {
    throw new Error("Item does not belong to this report.");
  }
  if (source.source !== "project_management") {
    throw new Error("Only PM items can be merged.");
  }

  // Keep the source's synthesized summary as part of the merged notes when it
  // differs from the target's — the summary is how the PM row showed up in the
  // list, so preserving it avoids losing context.
  const sourceSummaryNote =
    source.summary && source.summary.trim() !== target.summary.trim()
      ? source.summary
      : null;
  const mergedNotes = joinNotes(target.pmNotes, sourceSummaryNote, source.pmNotes);

  await prisma.$transaction([
    prisma.reportItem.update({
      where: { id: target.id },
      data: {
        workedMinutes: target.workedMinutes + source.workedMinutes,
        pmNotes: mergedNotes,
      },
    }),
    prisma.reportItem.delete({ where: { id: source.id } }),
  ]);

  revalidatePath(`/admin/reports/${reportId}`);
}

export async function updatePortaNotes(formData: FormData) {
  const reportId = Number(formData.get("reportId"));
  const itemId = Number(formData.get("itemId"));
  const notes = String(formData.get("portaNotes") ?? "").trim();
  if (!reportId || !itemId) throw new Error("Missing ids.");

  const report = await loadDraftReport(reportId);

  const item = await prisma.reportItem.findUnique({ where: { id: itemId } });
  if (!item || item.reportId !== report.id) notFound();

  await prisma.reportItem.update({
    where: { id: itemId },
    data: { portaNotes: notes || null },
  });

  revalidatePath(`/admin/reports/${reportId}`);
}

export async function updateItemSummary(formData: FormData) {
  const reportId = Number(formData.get("reportId"));
  const itemId = Number(formData.get("itemId"));
  const summary = String(formData.get("summary") ?? "").trim();
  if (!reportId || !itemId) throw new Error("Missing ids.");
  if (!summary) throw new Error("Summary cannot be empty.");

  const report = await loadDraftReport(reportId);

  const item = await prisma.reportItem.findUnique({ where: { id: itemId } });
  if (!item || item.reportId !== report.id) notFound();
  if (item.source !== "project_management") {
    throw new Error("Only PM item summaries can be edited.");
  }

  await prisma.reportItem.update({
    where: { id: itemId },
    data: { summary },
  });

  revalidatePath(`/admin/reports/${reportId}`);
}
