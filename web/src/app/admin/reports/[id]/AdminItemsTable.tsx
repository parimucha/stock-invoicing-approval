"use client";

import { Fragment, useMemo, useState } from "react";
import type { ReportItem } from "@prisma/client";

import { formatCzk, minutesToCzk, minutesToHours, secondsToHours, diffHours } from "@/lib/format";
import { BudgetBar } from "@/components/BudgetBar";
import { JiraLink } from "@/components/JiraLink";
import { PendingButton } from "@/components/PendingButton";
import {
  mergeItems,
  toggleInternal,
  updateItemGroup,
  updateItemSummary,
  updatePortaNotes,
} from "./actions";

export type MergeTarget = { id: number; label: string; isJira: boolean };
export type GroupProject = { id: string; name: string };

type ItemWithAssignments = ReportItem & {
  assignments: { project: { name: string } }[];
};

type Props = {
  items: ItemWithAssignments[];
  reportId: number;
  jiraBaseUrl: string | null;
  editable: boolean;
  mergeTargets: MergeTarget[];
  hourlyRateCzk: number | null;
  projects: GroupProject[];
};

type SortKey = "worked-desc" | "worked-asc" | "over" | "under" | "key";
type StatusFilter = "all" | "pending" | "approved" | "rejected";
type SourceFilter = "all" | "jira" | "pm";

export function AdminItemsTable({
  items,
  reportId,
  jiraBaseUrl,
  editable,
  mergeTargets,
  hourlyRateCzk,
  projects,
}: Props) {
  const [sort, setSort] = useState<SortKey>("worked-desc");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [source, setSource] = useState<SourceFilter>("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (status !== "all" && it.approval !== status) return false;
      if (source === "jira" && !it.jiraKey) return false;
      if (source === "pm" && it.jiraKey) return false;
      if (!q) return true;
      const labels = (it.jiraLabels as string[] | null) ?? [];
      const hay = [
        it.jiraKey ?? "",
        it.summary,
        it.parentKey ?? "",
        it.parentSummary ?? "",
        ...labels,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [items, status, source, query]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      switch (sort) {
        case "worked-desc":
          return b.workedMinutes - a.workedMinutes;
        case "worked-asc":
          return a.workedMinutes - b.workedMinutes;
        case "over": {
          const da = diff(a);
          const db = diff(b);
          return (db ?? -Infinity) - (da ?? -Infinity);
        }
        case "under": {
          const da = diff(a);
          const db = diff(b);
          return (da ?? Infinity) - (db ?? Infinity);
        }
        case "key":
          return (a.jiraKey ?? "~").localeCompare(b.jiraKey ?? "~");
      }
    });
    return arr;
  }, [filtered, sort]);

  const colCount = editable ? 9 : 8;

  return (
    <div className="space-y-3">
      <FilterBar
        sort={sort}
        setSort={setSort}
        status={status}
        setStatus={setStatus}
        source={source}
        setSource={setSource}
        query={query}
        setQuery={setQuery}
        resultCount={sorted.length}
        totalCount={items.length}
      />

      <section className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-neutral-600">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Key</th>
              <th className="text-left px-3 py-2 font-medium">Type</th>
              <th className="text-left px-3 py-2 font-medium">Summary</th>
              <th className="text-right px-3 py-2 font-medium">Worked</th>
              <th className="text-right px-3 py-2 font-medium">Est.</th>
              <th className="text-right px-3 py-2 font-medium">Δ</th>
              <th className="text-left px-3 py-2 font-medium">Projects</th>
              <th className="text-left px-3 py-2 font-medium">Approval</th>
              {editable && <th className="text-left px-3 py-2 font-medium">Edit</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((it) => {
              const canEdit = editable;
              const isPm = it.source === "project_management";
              const rowClass = it.internal
                ? "border-t border-neutral-100 align-top bg-neutral-50/60 text-neutral-500"
                : "border-t border-neutral-100 align-top";
              return (
                <Fragment key={it.id}>
                  <tr className={rowClass}>
                    <td className="px-3 py-2 font-mono text-xs">
                      {it.jiraKey ? (
                        <JiraLink
                          jiraKey={it.jiraKey}
                          jiraBaseUrl={jiraBaseUrl}
                          className="hover:underline"
                        />
                      ) : (
                        <span className="text-neutral-400">PM</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {it.jiraIssuetype && <IssueTypeBadge type={it.jiraIssuetype} />}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span>{it.summary}</span>
                        {it.internal && <InternalBadge />}
                      </div>
                      {it.parentSummary && (
                        <div className="text-xs text-neutral-500">
                          parent:{" "}
                          <JiraLink
                            jiraKey={it.parentKey}
                            jiraBaseUrl={jiraBaseUrl}
                            className="font-mono hover:underline"
                          />{" "}
                          {it.parentSummary}
                        </div>
                      )}
                      {it.portaNotes && (
                        <div className="mt-1 text-xs rounded border border-blue-200 bg-blue-50 px-2 py-1 text-blue-900 whitespace-pre-wrap">
                          <span className="font-semibold">PORTA:</span> {it.portaNotes}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div>{minutesToHours(it.workedMinutes)}</div>
                      {hourlyRateCzk != null && (
                        <div className="text-xs text-neutral-500">
                          {formatCzk(minutesToCzk(it.workedMinutes, hourlyRateCzk))}
                        </div>
                      )}
                      <BudgetBar
                        workedMinutes={it.workedMinutes}
                        estimatedSeconds={it.estimatedSeconds}
                        className="mt-1 w-24 ml-auto"
                      />
                      {it.totalWorkedMinutes != null && it.jiraKey && (
                        <div
                          className="mt-2 pt-2 border-t border-dashed border-neutral-300/80"
                          title="Total worked on this JIRA ticket across all months"
                        >
                          <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-400">
                            Lifetime
                          </div>
                          <div className="text-xs text-neutral-600">
                            {minutesToHours(it.totalWorkedMinutes)} h total
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {secondsToHours(it.estimatedSeconds)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {diffHours(it.estimatedSeconds, it.workedMinutes)}
                    </td>
                    <td className="px-3 py-2">
                      {it.assignments.length === 0 ? (
                        <span className="text-xs text-neutral-400">Unassigned</span>
                      ) : (
                        it.assignments.map((a) => a.project.name).join(", ")
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <ApprovalBadge approval={it.approval} />
                      {it.reviewerComment && (
                        <div className="text-xs text-neutral-500 italic mt-1">
                          “{it.reviewerComment}”
                        </div>
                      )}
                    </td>
                    {editable && (
                      <td className="px-3 py-2 align-top">
                        {canEdit && (
                          <details className="inline-block">
                            <summary className="cursor-pointer list-none select-none text-xs">
                              <span className="inline-block rounded border border-neutral-300 bg-white px-2 py-0.5 hover:bg-neutral-50">
                                Edit
                              </span>
                            </summary>
                          </details>
                        )}
                      </td>
                    )}
                  </tr>
                  {canEdit && (
                    <tr className="edit-row bg-neutral-50 border-t border-neutral-100">
                      <td colSpan={colCount} className="px-4 py-3">
                        <EditPanel
                          reportId={reportId}
                          itemId={it.id}
                          summary={it.summary}
                          portaNotes={it.portaNotes}
                          internal={it.internal}
                          isPm={isPm}
                          targets={mergeTargets.filter((t) => t.id !== it.id)}
                          projects={projects}
                          currentGroupProjectId={
                            ((it.suggestedProjects as string[]) ?? [])[0] ?? ""
                          }
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={colCount}
                  className="px-4 py-6 text-center text-sm text-neutral-500 italic"
                >
                  No items match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function diff(it: ItemWithAssignments): number | null {
  if (it.estimatedSeconds == null) return null;
  const estMinutes = it.estimatedSeconds / 60;
  return it.workedMinutes - estMinutes;
}

type FilterBarProps = {
  sort: SortKey;
  setSort: (v: SortKey) => void;
  status: StatusFilter;
  setStatus: (v: StatusFilter) => void;
  source: SourceFilter;
  setSource: (v: SourceFilter) => void;
  query: string;
  setQuery: (v: string) => void;
  resultCount: number;
  totalCount: number;
};

function FilterBar({
  sort,
  setSort,
  status,
  setStatus,
  source,
  setSource,
  query,
  setQuery,
  resultCount,
  totalCount,
}: FilterBarProps) {
  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-3 space-y-2">
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="search"
          placeholder="Search key, summary, label…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-[200px] text-sm border border-neutral-300 rounded px-2 py-1"
        />
        <label className="text-xs text-neutral-600 flex items-center gap-1">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="border border-neutral-300 rounded px-1.5 py-1 text-sm text-neutral-800"
          >
            <option value="worked-desc">Worked (high → low)</option>
            <option value="worked-asc">Worked (low → high)</option>
            <option value="over">Over budget first</option>
            <option value="under">Under budget first</option>
            <option value="key">JIRA key</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-4 text-xs items-center">
        <PillGroup
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            ["all", "All"],
            ["pending", "Pending"],
            ["approved", "Approved"],
            ["rejected", "Rejected"],
          ]}
        />
        <PillGroup
          label="Source"
          value={source}
          onChange={setSource}
          options={[
            ["all", "All"],
            ["jira", "JIRA"],
            ["pm", "PM"],
          ]}
        />
        <div className="ml-auto text-neutral-500">
          {resultCount === totalCount
            ? `${totalCount} ${totalCount === 1 ? "item" : "items"}`
            : `${resultCount} of ${totalCount} items`}
        </div>
      </div>
    </div>
  );
}

function PillGroup<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-neutral-600">{label}:</span>
      <div className="inline-flex rounded border border-neutral-200 overflow-hidden">
        {options.map(([v, l]) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`px-2 py-1 transition-colors ${
              value === v
                ? "bg-neutral-900 text-white"
                : "bg-white text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

function EditPanel({
  reportId,
  itemId,
  summary,
  portaNotes,
  internal,
  isPm,
  targets,
  projects,
  currentGroupProjectId,
}: {
  reportId: number;
  itemId: number;
  summary: string;
  portaNotes: string | null;
  internal: boolean;
  isPm: boolean;
  targets: MergeTarget[];
  projects: GroupProject[];
  currentGroupProjectId: string;
}) {
  const jiraTargets = targets.filter((t) => t.isJira);
  const pmTargets = targets.filter((t) => !t.isJira);
  return (
    <div className="space-y-4">
      <form action={updateItemGroup} className="space-y-1.5">
        <input type="hidden" name="reportId" value={reportId} />
        <input type="hidden" name="itemId" value={itemId} />
        <label className="block text-xs font-medium text-neutral-600">
          Show under group
          <span className="ml-1 font-normal text-neutral-500">
            — controls which project section the reviewer sees this item under
          </span>
        </label>
        <div className="flex items-center gap-2">
          <select
            name="groupProjectId"
            defaultValue={currentGroupProjectId}
            className="text-sm border border-neutral-300 rounded px-2 py-1 bg-white"
          >
            <option value="">Unassigned</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <PendingButton
            className="text-xs border border-neutral-300 rounded px-2 py-1 hover:bg-white bg-white"
            pendingLabel="Saving…"
          >
            Save group
          </PendingButton>
        </div>
      </form>

      <form action={toggleInternal}>
        <input type="hidden" name="reportId" value={reportId} />
        <input type="hidden" name="itemId" value={itemId} />
        <PendingButton
          className={`text-xs rounded px-2 py-1 border ${
            internal
              ? "bg-amber-100 border-amber-300 text-amber-900 hover:bg-amber-50"
              : "border-neutral-300 bg-white hover:bg-white text-neutral-700"
          }`}
          pendingLabel="Saving…"
        >
          {internal ? "Unmark internal" : "Mark as internal (hide from client)"}
        </PendingButton>
      </form>

      <form action={updatePortaNotes} className="space-y-1.5">
        <input type="hidden" name="reportId" value={reportId} />
        <input type="hidden" name="itemId" value={itemId} />
        <label className="block text-xs font-medium text-neutral-600">
          PORTA notes
          <span className="ml-1 font-normal text-neutral-500">
            — shown to Stock on the review card (read-only)
          </span>
        </label>
        <textarea
          name="portaNotes"
          defaultValue={portaNotes ?? ""}
          rows={3}
          className="w-full text-sm border border-neutral-300 rounded px-2 py-1 bg-white"
          placeholder="Context for the client about this item…"
        />
        <PendingButton
          className="text-xs border border-neutral-300 rounded px-2 py-1 hover:bg-white bg-white"
          pendingLabel="Saving…"
        >
          Save notes
        </PendingButton>
      </form>

      {isPm && (
        <div className="grid gap-6 md:grid-cols-2 pt-3 border-t border-neutral-200">
          <form action={updateItemSummary} className="space-y-1.5">
            <input type="hidden" name="reportId" value={reportId} />
            <input type="hidden" name="itemId" value={itemId} />
            <label className="block text-xs font-medium text-neutral-600">Summary</label>
            <input
              name="summary"
              defaultValue={summary}
              required
              className="w-full text-sm border border-neutral-300 rounded px-2 py-1 bg-white"
            />
            <PendingButton
              className="text-xs border border-neutral-300 rounded px-2 py-1 hover:bg-white bg-white"
              pendingLabel="Saving…"
            >
              Save summary
            </PendingButton>
          </form>

          {targets.length > 0 && (
            <form action={mergeItems} className="space-y-1.5">
              <input type="hidden" name="reportId" value={reportId} />
              <input type="hidden" name="sourceId" value={itemId} />
              <label className="block text-xs font-medium text-neutral-600">Merge into…</label>
              <select
                name="targetId"
                required
                defaultValue=""
                className="w-full text-sm border border-neutral-300 rounded px-2 py-1 bg-white"
              >
                <option value="" disabled>
                  Pick a target…
                </option>
                {jiraTargets.length > 0 && (
                  <optgroup label="JIRA items">
                    {jiraTargets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </optgroup>
                )}
                {pmTargets.length > 0 && (
                  <optgroup label="PM items">
                    {pmTargets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <p className="text-xs text-neutral-500">
                Minutes sum into the target; this row&apos;s notes are appended and the row is removed.
              </p>
              <PendingButton
                className="text-xs border border-neutral-300 rounded px-2 py-1 hover:bg-white bg-white"
                pendingLabel="Merging…"
              >
                Merge
              </PendingButton>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function InternalBadge() {
  return (
    <span className="inline-block rounded px-1.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-900 border border-amber-200">
      Internal
    </span>
  );
}

function IssueTypeBadge({ type }: { type: string }) {
  const lower = type.toLowerCase();
  const styles = lower.includes("bug")
    ? "bg-red-50 text-red-700"
    : lower.includes("sub")
      ? "bg-neutral-100 text-neutral-600"
      : lower.includes("scope")
        ? "bg-purple-50 text-purple-700"
        : "bg-blue-50 text-blue-700";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${styles}`}>
      {type}
    </span>
  );
}

function ApprovalBadge({ approval }: { approval: string }) {
  const styles: Record<string, string> = {
    pending: "bg-neutral-100 text-neutral-600",
    approved: "bg-green-50 text-green-700",
    rejected: "bg-red-50 text-red-700",
  };
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
        styles[approval] ?? "bg-neutral-100"
      }`}
    >
      {approval}
    </span>
  );
}
