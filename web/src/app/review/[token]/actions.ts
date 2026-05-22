"use server";

import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

async function loadReport(token: string) {
  const report = await prisma.report.findUnique({ where: { magicToken: token } });
  if (!report) notFound();
  return report;
}

function isLocked(status: string): boolean {
  return status === "approved" || status === "rejected";
}

async function ensureUnderReview(reportId: number, currentStatus: string) {
  if (currentStatus === "sent") {
    await prisma.report.update({
      where: { id: reportId },
      data: { status: "under_review" },
    });
  }
}

export async function saveItem(formData: FormData) {
  const token = String(formData.get("token"));
  const itemId = Number(formData.get("itemId"));
  const report = await loadReport(token);
  if (isLocked(report.status)) throw new Error("Report is locked.");

  const approval = String(formData.get("approval") ?? "pending") as
    | "pending"
    | "approved"
    | "rejected";
  const comment = String(formData.get("comment") ?? "").trim();
  const projectIds = formData.getAll("projects").map(String).filter(Boolean);

  const item = await prisma.reportItem.findUnique({ where: { id: itemId } });
  if (!item || item.reportId !== report.id) throw new Error("Item not found.");

  // An item with no projects ticked has nowhere to bill — it would land in
  // the Unassigned bucket and quietly inflate the invoice's "Unassigned"
  // row. The client-side UI also blocks this, but the server is the
  // authoritative gate (handles direct API calls, stale clients, etc.).
  if (approval === "approved" && projectIds.length === 0) {
    throw new Error(
      "Tick at least one project before approving — approved items must bill somewhere.",
    );
  }

  await prisma.$transaction([
    prisma.projectAssignment.deleteMany({ where: { itemId } }),
    prisma.projectAssignment.createMany({
      data: projectIds.map((pid) => ({ itemId, projectId: pid })),
      skipDuplicates: true,
    }),
    prisma.reportItem.update({
      where: { id: itemId },
      data: { approval, reviewerComment: comment || null },
    }),
  ]);
  await ensureUnderReview(report.id, report.status);
  // Invalidate the cache for this report so a back-forward navigation or
  // refresh (notably MS Edge's BFCache) doesn't serve a snapshot from before
  // the save. The client UI already reflects the change via local state, but
  // server-rendered HTML must agree on the next render.
  revalidatePath(`/review/${token}`);
  revalidatePath(`/admin/reports/${report.id}`);
}

export async function saveReviewerNote(formData: FormData) {
  const token = String(formData.get("token"));
  const note = String(formData.get("note") ?? "").trim();
  const report = await loadReport(token);
  if (isLocked(report.status)) throw new Error("Report is locked.");
  await prisma.report.update({
    where: { id: report.id },
    data: { reviewerNote: note || null },
  });
  await ensureUnderReview(report.id, report.status);
  revalidatePath(`/review/${token}`);
  revalidatePath(`/admin/reports/${report.id}`);
}

export async function reopenReview(formData: FormData) {
  const token = String(formData.get("token"));
  const report = await loadReport(token);
  if (!isLocked(report.status)) {
    throw new Error("Report is not locked.");
  }
  await prisma.report.update({
    where: { id: report.id },
    data: { status: "under_review", reviewedAt: null },
  });
  revalidatePath(`/review/${token}`);
  revalidatePath(`/admin/reports/${report.id}`);
}

export async function signOff(formData: FormData) {
  const token = String(formData.get("token"));
  const decision = String(formData.get("decision"));
  if (decision !== "approved" && decision !== "rejected") {
    throw new Error("Invalid decision.");
  }
  const report = await loadReport(token);
  if (isLocked(report.status)) throw new Error("Report is already signed off.");

  // Approving a report while items are still pending would silently exclude
  // them from the invoice — pending items don't bill. Force the reviewer to
  // approve or reject each item first. The UI also disables the button, but
  // the server is the authoritative gate.
  if (decision === "approved") {
    const pendingCount = await prisma.reportItem.count({
      where: { reportId: report.id, internal: false, approval: "pending" },
    });
    if (pendingCount > 0) {
      throw new Error(
        `Resolve all ${pendingCount} pending item${pendingCount === 1 ? "" : "s"} before approving the report.`,
      );
    }
  }

  await prisma.report.update({
    where: { id: report.id },
    data: { status: decision, reviewedAt: new Date() },
  });
  revalidatePath(`/review/${token}`);
  revalidatePath(`/admin/reports/${report.id}`);
}
