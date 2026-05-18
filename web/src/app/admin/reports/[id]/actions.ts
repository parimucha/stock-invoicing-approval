"use server";

import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { fetchLifetimeMinutesForKeys } from "@/lib/productive";
import { fetchJiraStatusesForKeys } from "@/lib/jira";

export type RefreshTotalsResult =
  | {
      ok: true;
      updated: number;
      unchanged: number;
      missingFromProductive: number;
      keysQueried: number;
    }
  | { ok: false; error: string };

export type RefreshStatusesResult =
  | {
      ok: true;
      updated: number;
      unchanged: number;
      missingFromJira: number;
      keysQueried: number;
    }
  | { ok: false; error: string };

async function loadDraftReport(reportId: number) {
  await requireAdmin();
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

  // Re-derive the target's source from its JIRA key. The source field drives
  // the PM-share calculation; if the target has a jiraKey it must be
  // source=jira so the merged minutes don't keep counting as PM. This also
  // self-heals any rows that ended up with mismatched source/jiraKey from
  // earlier flows.
  const targetSource = target.jiraKey ? "jira" : "project_management";

  await prisma.$transaction([
    prisma.reportItem.update({
      where: { id: target.id },
      data: {
        workedMinutes: target.workedMinutes + source.workedMinutes,
        pmNotes: mergedNotes,
        source: targetSource,
      },
    }),
    prisma.reportItem.delete({ where: { id: source.id } }),
  ]);

  revalidatePath(`/admin/reports/${reportId}`);
  revalidatePath(`/review/${report.magicToken}`);
}

export async function resetReport(formData: FormData) {
  await requireAdmin();
  const reportId = Number(formData.get("id"));
  if (!reportId) throw new Error("Missing id.");

  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: {
      items: { select: { id: true, suggestedProjects: true } },
    },
  });
  if (!report) notFound();

  const newAssignments = report.items.flatMap((it) => {
    const suggestions = (it.suggestedProjects as string[]) ?? [];
    return suggestions.map((projectId) => ({ itemId: it.id, projectId }));
  });
  const itemIds = report.items.map((i) => i.id);

  await prisma.$transaction([
    prisma.projectAssignment.deleteMany({
      where: { itemId: { in: itemIds } },
    }),
    ...(newAssignments.length > 0
      ? [
          prisma.projectAssignment.createMany({
            data: newAssignments,
            skipDuplicates: true,
          }),
        ]
      : []),
    prisma.reportItem.updateMany({
      where: { reportId: report.id },
      data: { approval: "pending", reviewerComment: null },
    }),
    prisma.report.update({
      where: { id: report.id },
      data: {
        status: "draft",
        sentAt: null,
        reviewedAt: null,
        reviewerNote: null,
      },
    }),
  ]);

  revalidatePath(`/admin/reports/${reportId}`);
  revalidatePath(`/review/${report.magicToken}`);
}

export async function toggleInternal(formData: FormData) {
  const reportId = Number(formData.get("reportId"));
  const itemId = Number(formData.get("itemId"));
  if (!reportId || !itemId) throw new Error("Missing ids.");

  const report = await loadDraftReport(reportId);

  const item = await prisma.reportItem.findUnique({ where: { id: itemId } });
  if (!item || item.reportId !== report.id) notFound();

  await prisma.reportItem.update({
    where: { id: itemId },
    data: { internal: !item.internal },
  });

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

export async function addItem(formData: FormData) {
  const reportId = Number(formData.get("reportId"));
  if (!reportId) throw new Error("Missing report id.");

  const report = await loadDraftReport(reportId);

  const summary = String(formData.get("summary") ?? "").trim();
  if (!summary) throw new Error("Summary is required.");

  const hoursStr = String(formData.get("hoursWorked") ?? "").trim();
  const hours = Number(hoursStr);
  if (!Number.isFinite(hours) || hours < 0) {
    throw new Error("Hours worked must be a non-negative number.");
  }
  const workedMinutes = Math.round(hours * 60);

  const jiraKey = String(formData.get("jiraKey") ?? "").trim() || null;
  const portaNotes = String(formData.get("portaNotes") ?? "").trim() || null;
  const internal = formData.get("internal") != null;
  const projectIds = formData
    .getAll("projectIds")
    .map(String)
    .filter(Boolean);

  if (projectIds.length > 0) {
    const known = await prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true },
    });
    if (known.length !== new Set(projectIds).size) {
      throw new Error("Unknown project id submitted.");
    }
  }

  await prisma.reportItem.create({
    data: {
      reportId: report.id,
      // Source is keyed off the JIRA link so the row classifies consistently
      // with everything that came from the ingest pipeline; the PM-share cap
      // and source filter both use this field.
      source: jiraKey ? "jira" : "project_management",
      jiraKey,
      summary,
      workedMinutes,
      jiraLabels: [],
      suggestedProjects: projectIds,
      portaNotes,
      internal,
      assignments: {
        create: projectIds.map((pid) => ({ projectId: pid })),
      },
    },
  });

  revalidatePath(`/admin/reports/${reportId}`);
  revalidatePath(`/review/${report.magicToken}`);
}

export async function updateHourlyRate(formData: FormData) {
  await requireAdmin();
  const reportId = Number(formData.get("reportId"));
  if (!reportId) throw new Error("Missing report id.");

  const raw = String(formData.get("hourlyRateCzk") ?? "").trim();
  let rate: number | null;
  if (raw === "") {
    rate = null;
  } else {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      throw new Error("Hourly rate must be a whole non-negative number.");
    }
    rate = n;
  }

  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) notFound();

  await prisma.report.update({
    where: { id: reportId },
    data: { hourlyRateCzk: rate },
  });

  revalidatePath(`/admin/reports/${reportId}`);
  revalidatePath(`/review/${report.magicToken}`);
  revalidatePath("/admin");
}

export async function updateItemGroup(formData: FormData) {
  const reportId = Number(formData.get("reportId"));
  const itemId = Number(formData.get("itemId"));
  const groupProjectId = String(formData.get("groupProjectId") ?? "").trim();
  if (!reportId || !itemId) throw new Error("Missing ids.");

  const report = await loadDraftReport(reportId);

  const item = await prisma.reportItem.findUnique({ where: { id: itemId } });
  if (!item || item.reportId !== report.id) notFound();

  let nextSuggested: string[];
  if (groupProjectId === "") {
    // "Unassigned" — drop the suggestion, item lands in the Unassigned bucket.
    nextSuggested = [];
  } else {
    const project = await prisma.project.findUnique({
      where: { id: groupProjectId },
    });
    if (!project) throw new Error("Unknown project id.");
    nextSuggested = [groupProjectId];
  }

  // Sync both the grouping hint (suggestedProjects, used by the review/admin
  // item layout) and the billing assignment (ProjectAssignment rows, used by
  // the invoice math). Updating only the suggestion — as this action did
  // originally — left items visually under a group while contributing zero
  // to that group's bucket, so they silently fell into "Unassigned" on the
  // invoice preview.
  await prisma.$transaction([
    prisma.projectAssignment.deleteMany({ where: { itemId } }),
    ...(nextSuggested.length > 0
      ? [
          prisma.projectAssignment.createMany({
            data: nextSuggested.map((projectId) => ({ itemId, projectId })),
            skipDuplicates: true,
          }),
        ]
      : []),
    prisma.reportItem.update({
      where: { id: itemId },
      data: { suggestedProjects: nextSuggested },
    }),
  ]);

  revalidatePath(`/admin/reports/${reportId}`);
  revalidatePath(`/review/${report.magicToken}`);
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

// Refreshes lifetime totals for every JIRA-linked item in a report by
// hitting Productive directly. Only ReportItem.totalWorkedMinutes is
// touched — everything the admin or reviewer has edited is left alone.
export async function refreshLifetimeTotals(
  _prev: RefreshTotalsResult | null,
  formData: FormData,
): Promise<RefreshTotalsResult> {
  try {
    await requireAdmin();
    const reportId = Number(formData.get("reportId"));
    if (!reportId) return { ok: false, error: "Missing report id." };

    const items = await prisma.reportItem.findMany({
      where: { reportId, source: "jira", jiraKey: { not: null } },
      select: { id: true, jiraKey: true, totalWorkedMinutes: true },
    });
    const jiraKeys = [...new Set(items.map((i) => i.jiraKey).filter((k): k is string => !!k))];
    if (jiraKeys.length === 0) {
      return { ok: true, updated: 0, unchanged: 0, missingFromProductive: 0, keysQueried: 0 };
    }

    const totalsByKey = await fetchLifetimeMinutesForKeys(jiraKeys);

    let updated = 0;
    let unchanged = 0;
    let missingFromProductive = 0;
    const updates: Array<{ id: number; minutes: number }> = [];

    for (const item of items) {
      const key = item.jiraKey;
      if (!key) continue;
      const minutes = totalsByKey.get(key);
      if (minutes == null) {
        missingFromProductive += 1;
        continue;
      }
      if (item.totalWorkedMinutes === minutes) {
        unchanged += 1;
        continue;
      }
      updates.push({ id: item.id, minutes });
    }

    if (updates.length > 0) {
      await prisma.$transaction(
        updates.map((u) =>
          prisma.reportItem.update({
            where: { id: u.id },
            data: { totalWorkedMinutes: u.minutes },
          }),
        ),
      );
      updated = updates.length;
    }

    const report = await prisma.report.findUnique({
      where: { id: reportId },
      select: { magicToken: true },
    });
    revalidatePath(`/admin/reports/${reportId}`);
    if (report) revalidatePath(`/review/${report.magicToken}`);

    return {
      ok: true,
      updated,
      unchanged,
      missingFromProductive,
      keysQueried: jiraKeys.length,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Refreshes the JIRA status text for every JIRA-linked item by hitting the
// Atlassian REST API directly. Only ReportItem.jiraStatus is touched — admin
// and reviewer edits stay put.
export async function refreshJiraStatuses(
  _prev: RefreshStatusesResult | null,
  formData: FormData,
): Promise<RefreshStatusesResult> {
  try {
    await requireAdmin();
    const reportId = Number(formData.get("reportId"));
    if (!reportId) return { ok: false, error: "Missing report id." };

    const items = await prisma.reportItem.findMany({
      where: { reportId, source: "jira", jiraKey: { not: null } },
      select: { id: true, jiraKey: true, jiraStatus: true },
    });
    const jiraKeys = [...new Set(items.map((i) => i.jiraKey).filter((k): k is string => !!k))];
    if (jiraKeys.length === 0) {
      return { ok: true, updated: 0, unchanged: 0, missingFromJira: 0, keysQueried: 0 };
    }

    const statusByKey = await fetchJiraStatusesForKeys(jiraKeys);

    let unchanged = 0;
    let missingFromJira = 0;
    const updates: Array<{ id: number; status: string }> = [];

    for (const item of items) {
      const key = item.jiraKey;
      if (!key) continue;
      const status = statusByKey.get(key);
      if (status == null) {
        missingFromJira += 1;
        continue;
      }
      if (item.jiraStatus === status) {
        unchanged += 1;
        continue;
      }
      updates.push({ id: item.id, status });
    }

    if (updates.length > 0) {
      await prisma.$transaction(
        updates.map((u) =>
          prisma.reportItem.update({
            where: { id: u.id },
            data: { jiraStatus: u.status },
          }),
        ),
      );
    }

    const report = await prisma.report.findUnique({
      where: { id: reportId },
      select: { magicToken: true },
    });
    revalidatePath(`/admin/reports/${reportId}`);
    if (report) revalidatePath(`/review/${report.magicToken}`);

    return {
      ok: true,
      updated: updates.length,
      unchanged,
      missingFromJira,
      keysQueried: jiraKeys.length,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
