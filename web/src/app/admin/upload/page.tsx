import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { parseUploadReport } from "@/lib/report-schema";
import { newMagicToken, requireAdmin } from "@/lib/auth";
import { PendingButton } from "@/components/PendingButton";
import { parseBackup, type ParsedBackup } from "@/lib/report-backup";

async function uploadReport(formData: FormData) {
  "use server";
  await requireAdmin();

  const file = formData.get("file");
  const pasted = String(formData.get("json") ?? "").trim();

  let text: string;
  if (file instanceof File && file.size > 0) {
    text = await file.text();
  } else if (pasted) {
    text = pasted;
  } else {
    throw new Error("Provide a JSON file or paste JSON in the textarea.");
  }

  const parsed = parseUploadReport(JSON.parse(text));

  const existing = await prisma.report.findUnique({ where: { label: parsed.label } });
  if (existing) {
    if (existing.status === "under_review" || existing.status === "approved") {
      throw new Error(
        `Report ${parsed.label} is ${existing.status}. Replace blocked — unlock it first.`,
      );
    }
    // Replace in place: clear items and re-insert.
    await prisma.report.delete({ where: { id: existing.id } });
  }

  const created = await prisma.report.create({
    data: {
      label: parsed.label,
      periodStart: new Date(parsed.period_start),
      periodEnd: new Date(parsed.period_end),
      productiveDealId: parsed.productive_deal_id ?? null,
      productiveBudgetName: parsed.productive_budget_name ?? null,
      magicToken: newMagicToken(),
      items: {
        create: parsed.items.map((i) => ({
          source: i.source,
          jiraKey: i.jira_key,
          summary: i.summary,
          workedMinutes: i.worked_minutes,
          totalWorkedMinutes: i.total_worked_minutes,
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

  redirect(`/admin/reports/${created.id}`);
}

function buildCreateData(backup: ParsedBackup, id: number | undefined, magicToken: string) {
  const r = backup.report;
  return {
    ...(id !== undefined ? { id } : {}),
    label: r.label,
    periodStart: new Date(r.periodStart),
    periodEnd: new Date(r.periodEnd),
    productiveDealId: r.productiveDealId,
    productiveBudgetName: r.productiveBudgetName,
    hourlyRateCzk: r.hourlyRateCzk,
    status: r.status,
    magicToken,
    reviewerNote: r.reviewerNote,
    createdAt: new Date(r.createdAt),
    sentAt: r.sentAt ? new Date(r.sentAt) : null,
    reviewedAt: r.reviewedAt ? new Date(r.reviewedAt) : null,
    items: {
      create: r.items.map((it) => ({
        source: it.source,
        jiraKey: it.jiraKey,
        summary: it.summary,
        workedMinutes: it.workedMinutes,
        totalWorkedMinutes: it.totalWorkedMinutes,
        estimatedSeconds: it.estimatedSeconds,
        jiraIssuetype: it.jiraIssuetype,
        jiraStatus: it.jiraStatus,
        jiraLabels: it.jiraLabels,
        parentKey: it.parentKey,
        parentSummary: it.parentSummary,
        pmNotes: it.pmNotes,
        portaNotes: it.portaNotes,
        internal: it.internal,
        suggestedProjects: it.suggestedProjects,
        approval: it.approval,
        reviewerComment: it.reviewerComment,
        assignments: { create: it.assignedProjects.map((projectId) => ({ projectId })) },
      })),
    },
  };
}

async function restoreBackup(formData: FormData) {
  "use server";
  await requireAdmin();

  const file = formData.get("file");
  const pasted = String(formData.get("json") ?? "").trim();
  const confirmed = formData.get("confirmOverwrite") === "on";

  let text: string;
  if (file instanceof File && file.size > 0) {
    text = await file.text();
  } else if (pasted) {
    text = pasted;
  } else {
    throw new Error("Provide a backup JSON file or paste JSON in the textarea.");
  }

  const backup = parseBackup(JSON.parse(text));

  // 1. Ensure every referenced project exists (create missing, leave existing).
  for (const p of backup.projects) {
    await prisma.project.upsert({
      where: { id: p.id },
      update: {},
      create: { id: p.id, name: p.name, sortOrder: p.sortOrder },
    });
  }

  // 2. Match by embedded id, falling back to unique label. When we fall back to
  // the label match, we reuse THAT row's id (not the backup's id) — restoring a
  // backup whose original id is free in this DB still updates the same-month row
  // rather than creating a duplicate.
  const byId = await prisma.report.findUnique({ where: { id: backup.report.id } });
  const target =
    byId ?? (await prisma.report.findUnique({ where: { label: backup.report.label } }));

  let resultId: number;

  if (target) {
    if (
      (target.status === "under_review" || target.status === "approved") &&
      !confirmed
    ) {
      throw new Error(
        `Report ${target.label} is ${target.status}. Tick the confirmation box to overwrite its live client-facing state.`,
      );
    }
    // Guard against unique-constraint conflicts from *other* reports before we
    // delete-and-recreate with the backup's label + token.
    const labelConflict = await prisma.report.findFirst({
      where: { label: backup.report.label, id: { not: target.id } },
    });
    if (labelConflict) {
      throw new Error(`A different report already uses label ${backup.report.label}.`);
    }
    const tokenConflict = await prisma.report.findFirst({
      where: { magicToken: backup.report.magicToken, id: { not: target.id } },
    });
    if (tokenConflict) {
      throw new Error(`A different report already uses this magic link token.`);
    }

    // Reusing target.id is safe for the autoincrement sequence: target.id was
    // generated by this DB's sequence (the row exists), so the sequence is
    // already past it. The create-new branch below never sets an explicit id.
    // Keep it that way — inserting an id ahead of the sequence would risk a
    // future collision.
    await prisma.$transaction(async (tx) => {
      await tx.report.delete({ where: { id: target.id } });
      await tx.report.create({
        data: buildCreateData(backup, target.id, backup.report.magicToken),
      });
    });
    resultId = target.id;
  } else {
    // Create new. Label is free (no id/label match). Preserve the token unless
    // another report already holds it, in which case mint a fresh one.
    const tokenOwner = await prisma.report.findUnique({
      where: { magicToken: backup.report.magicToken },
    });
    const token = tokenOwner ? newMagicToken() : backup.report.magicToken;
    const created = await prisma.report.create({
      data: buildCreateData(backup, undefined, token),
    });
    resultId = created.id;
  }

  redirect(`/admin/reports/${resultId}`);
}

export default function UploadPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Upload report</h1>
      <p className="text-sm text-neutral-600">
        Paste the JSON produced by the local ingestion script, or upload it as a file.
        If a report already exists for the same month in <em>draft</em> or <em>sent</em>{" "}
        status, it will be replaced. Reports in review or approved can't be replaced.
      </p>

      <form
        action={uploadReport}
        className="space-y-4 bg-white border border-neutral-200 rounded-lg p-6"
      >
        <label className="block">
          <span className="text-sm font-medium">JSON file</span>
          <input
            type="file"
            name="file"
            accept="application/json,.json"
            className="mt-1 block text-sm"
          />
        </label>

        <div className="text-xs text-neutral-500">or paste below</div>

        <label className="block">
          <span className="text-sm font-medium">JSON</span>
          <textarea
            name="json"
            rows={14}
            className="mt-1 w-full font-mono text-xs border border-neutral-300 rounded p-3"
            placeholder='{"label": "2026-03", ...}'
          />
        </label>

        <PendingButton
          className="bg-neutral-900 text-white rounded px-4 py-2 text-sm hover:bg-neutral-800"
          pendingLabel="Creating report…"
        >
          Create report
        </PendingButton>
      </form>

      <div className="border-t border-neutral-200 pt-6">
        <h2 className="text-lg font-semibold">Restore from backup</h2>
        <p className="text-sm text-neutral-600 mt-1">
          Upload a backup file downloaded from a report. If a matching report exists
          (same id or month), it is restored in place — approvals, notes, and the
          client magic link are preserved. Otherwise a new report is created.
        </p>

        <form
          action={restoreBackup}
          className="space-y-4 bg-white border border-neutral-200 rounded-lg p-6 mt-4"
        >
          <label className="block">
            <span className="text-sm font-medium">Backup JSON file</span>
            <input
              type="file"
              name="file"
              accept="application/json,.json"
              className="mt-1 block text-sm"
            />
          </label>

          <div className="text-xs text-neutral-500">or paste below</div>

          <label className="block">
            <span className="text-sm font-medium">Backup JSON</span>
            <textarea
              name="json"
              rows={10}
              className="mt-1 w-full font-mono text-xs border border-neutral-300 rounded p-3"
              placeholder='{"schemaVersion": 1, "report": { ... }}'
            />
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="confirmOverwrite" className="mt-0.5" />
            <span>
              I understand that restoring over a report currently in review or approved
              overwrites its live client-facing approvals and comments.
            </span>
          </label>

          <PendingButton
            className="bg-neutral-900 text-white rounded px-4 py-2 text-sm hover:bg-neutral-800"
            pendingLabel="Restoring…"
          >
            Restore report
          </PendingButton>
        </form>
      </div>
    </div>
  );
}
