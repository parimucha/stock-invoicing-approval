import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { parseUploadReport } from "@/lib/report-schema";
import { newMagicToken } from "@/lib/auth";

async function uploadReport(formData: FormData) {
  "use server";

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

        <button
          type="submit"
          className="bg-neutral-900 text-white rounded px-4 py-2 text-sm hover:bg-neutral-800"
        >
          Create report
        </button>
      </form>
    </div>
  );
}
