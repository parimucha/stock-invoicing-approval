"use client";

import { useCallback, useMemo, useState } from "react";
import type { Project, ReportItem } from "@prisma/client";

import { formatCzk, minutesToCzk, minutesToHours } from "@/lib/format";
import { PmShareIndicator } from "@/components/PmShareIndicator";
import { ApprovalBreakdownBar } from "@/components/ApprovalBreakdownBar";
import { ItemBreakdownCard } from "@/components/ItemBreakdownCard";
import { JiraLink } from "@/components/JiraLink";
import { ItemCard } from "./ItemCard";

type ItemWithAssignments = ReportItem & {
  assignments: { projectId: string }[];
};

type Props = {
  items: ItemWithAssignments[];
  projects: Project[];
  token: string;
  locked: boolean;
  jiraBaseUrl: string | null;
  hourlyRateCzk: number | null;
};

type SortKey = "worked-desc" | "worked-asc" | "over" | "under" | "key";
type StatusFilter = "all" | "pending" | "approved" | "rejected";
type SourceFilter = "all" | "jira" | "pm";
type GroupBy = "project" | "status" | "source" | "flat";

export function ReviewItems({
  items,
  projects,
  token,
  locked,
  jiraBaseUrl,
  hourlyRateCzk,
}: Props) {
  const [sort, setSort] = useState<SortKey>("worked-desc");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [source, setSource] = useState<SourceFilter>("all");
  const [query, setQuery] = useState("");
  const [hideApproved, setHideApproved] = useState(false);
  // "all" → no filter, "unassigned" → items with no projects ticked,
  // otherwise a project ID.
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [groupBy, setGroupBy] = useState<GroupBy>("project");

  const hasActiveFilters =
    query.trim() !== "" ||
    status !== "all" ||
    source !== "all" ||
    projectFilter !== "all" ||
    hideApproved;
  const clearAllFilters = useCallback(() => {
    setQuery("");
    setStatus("all");
    setSource("all");
    setProjectFilter("all");
    setHideApproved(false);
  }, []);
  // Per-project-group user override for the collapsed/expanded `<details>`.
  // Without this, React re-applies the JSX `open={...}` prop on every render
  // (every autosave triggers one) and snaps the disclosure back to the
  // auto-computed state, undoing manual clicks. Storing the user's choice
  // keyed by group name lets the auto-collapse rule still apply to groups
  // they haven't touched.
  const [groupOpenOverride, setGroupOpenOverride] = useState<
    Record<string, boolean>
  >({});

  // Assignments are hoisted here so the invoice overview stays live without a
  // server round-trip on every autosave. ItemCard becomes a controlled input.
  const [assignments, setAssignments] = useState<Record<number, string[]>>(() => {
    const map: Record<number, string[]> = {};
    for (const it of items) {
      map[it.id] = [...it.assignments.map((a) => a.projectId)].sort();
    }
    return map;
  });

  const setItemAssignments = useCallback((itemId: number, next: string[]) => {
    setAssignments((prev) => ({ ...prev, [itemId]: next }));
  }, []);

  // Only items the reviewer has explicitly approved contribute to invoice
  // totals, per-project buckets, and the PM-share cap. Pending items haven't
  // been signed off on yet; rejected items aren't being billed. Both still
  // render in their normal project group below (cards keep their existing
  // amber-ish / red borders) and each gets a dedicated summary card so the
  // reviewer sees exactly what's in / out at any moment.
  const pendingItems = useMemo(
    () => items.filter((i) => i.approval === "pending"),
    [items],
  );
  const rejectedItems = useMemo(
    () => items.filter((i) => i.approval === "rejected"),
    [items],
  );
  const approvedItems = useMemo(
    () => items.filter((i) => i.approval === "approved"),
    [items],
  );

  const totalMinutes = useMemo(
    () => approvedItems.reduce((s, i) => s + i.workedMinutes, 0),
    [approvedItems],
  );
  const pendingMinutes = useMemo(
    () => pendingItems.reduce((s, i) => s + i.workedMinutes, 0),
    [pendingItems],
  );
  const rejectedMinutes = useMemo(
    () => rejectedItems.reduce((s, i) => s + i.workedMinutes, 0),
    [rejectedItems],
  );
  const pmMinutes = useMemo(
    () =>
      approvedItems.reduce(
        (s, i) => (i.source === "project_management" ? s + i.workedMinutes : s),
        0,
      ),
    [approvedItems],
  );
  const buckets = useMemo(() => {
    const b: Record<string, number> = { Unassigned: 0 };
    for (const p of projects) b[p.name] = 0;
    for (const it of approvedItems) {
      const assigned = assignments[it.id] ?? [];
      if (assigned.length === 0) {
        b.Unassigned += it.workedMinutes;
      } else {
        const share = it.workedMinutes / assigned.length;
        for (const pid of assigned) {
          const p = projects.find((x) => x.id === pid);
          if (p) b[p.name] += share;
        }
      }
    }
    return b;
  }, [approvedItems, assignments, projects]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (status !== "all" && it.approval !== status) return false;
      if (hideApproved && it.approval === "approved") return false;
      if (source === "jira" && !it.jiraKey) return false;
      if (source === "pm" && it.jiraKey) return false;
      if (projectFilter !== "all") {
        const assigned = assignments[it.id] ?? [];
        if (projectFilter === "unassigned") {
          if (assigned.length !== 0) return false;
        } else if (!assigned.includes(projectFilter)) {
          return false;
        }
      }
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
  }, [items, status, source, query, hideApproved, projectFilter, assignments]);

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

  // Grouping. Project view follows the reviewer's live checkboxes
  // (assignments). An item assigned to N projects appears in each of those
  // groups, with its worked time split N ways (matching the invoice
  // overview math). Full editable card lives in its "primary" location
  // (lowest-sortOrder assigned project); compact read-only row elsewhere.
  // Other modes (status / source / flat) don't duplicate — each item
  // shows once as a full card.
  const groups = useMemo<
    Array<{
      name: string | null;
      items: Array<{
        item: ItemWithAssignments;
        minutes: number;
        primary: boolean;
      }>;
    }>
  >(() => {
    if (groupBy === "flat") {
      return [
        {
          name: null,
          items: sorted.map((it) => ({
            item: it,
            minutes: it.workedMinutes,
            primary: true,
          })),
        },
      ];
    }

    if (groupBy === "status") {
      const order = ["Pending", "Rejected", "Approved"] as const;
      const map: Record<string, ItemWithAssignments[]> = {
        Pending: [],
        Rejected: [],
        Approved: [],
      };
      for (const it of sorted) {
        const bucket =
          it.approval === "approved"
            ? "Approved"
            : it.approval === "rejected"
              ? "Rejected"
              : "Pending";
        map[bucket].push(it);
      }
      return order.map((name) => ({
        name,
        items: map[name].map((it) => ({
          item: it,
          minutes: it.workedMinutes,
          primary: true,
        })),
      }));
    }

    if (groupBy === "source") {
      const map: Record<string, ItemWithAssignments[]> = { JIRA: [], PM: [] };
      for (const it of sorted) {
        map[it.jiraKey ? "JIRA" : "PM"].push(it);
      }
      return (["JIRA", "PM"] as const).map((name) => ({
        name,
        items: map[name].map((it) => ({
          item: it,
          minutes: it.workedMinutes,
          primary: true,
        })),
      }));
    }

    // groupBy === "project"
    const order = [...projects.map((p) => p.name), "Unassigned"];
    const projectNameById = new Map(projects.map((p) => [p.id, p.name]));
    const map = new Map<
      string,
      Array<{ item: ItemWithAssignments; minutes: number; primary: boolean }>
    >();
    for (const name of order) map.set(name, []);

    // Pre-compute each item's primary project (first assigned, in sortOrder).
    const primaryProjectNameByItem = new Map<number, string>();
    for (const it of sorted) {
      const assigned = assignments[it.id] ?? [];
      if (assigned.length === 0) continue;
      for (const p of projects) {
        if (assigned.includes(p.id)) {
          primaryProjectNameByItem.set(it.id, p.name);
          break;
        }
      }
    }

    for (const it of sorted) {
      const assigned = assignments[it.id] ?? [];
      if (assigned.length === 0) {
        map.get("Unassigned")!.push({
          item: it,
          minutes: it.workedMinutes,
          primary: true,
        });
        continue;
      }
      const share = it.workedMinutes / assigned.length;
      const primaryName = primaryProjectNameByItem.get(it.id);
      const singleProjectFilter =
        projectFilter !== "all" && projectFilter !== "unassigned";
      for (const pid of assigned) {
        // When the reviewer filters to a single project, suppress the
        // compact-row duplicates in other project groups — they'd just be
        // noise outside the project they asked to see.
        if (singleProjectFilter && pid !== projectFilter) continue;
        const projectName = projectNameById.get(pid) ?? "Unassigned";
        // With a single-project filter the item only appears in one group,
        // so it must render as the editable card — even if its "natural"
        // primary (lowest-sortOrder assigned project) would have been
        // somewhere else.
        const primary = singleProjectFilter
          ? true
          : projectName === primaryName;
        map.get(projectName)?.push({
          item: it,
          minutes: share,
          primary,
        });
      }
    }
    return order.map((name) => ({ name, items: map.get(name) ?? [] }));
  }, [sorted, projects, assignments, projectFilter, groupBy]);

  return (
    <div className="space-y-6">
      <InvoiceOverview
        buckets={buckets}
        totalMinutes={totalMinutes}
        pmMinutes={pmMinutes}
        pendingMinutes={pendingMinutes}
        rejectedMinutes={rejectedMinutes}
        hourlyRateCzk={hourlyRateCzk}
      />

      <ItemBreakdownCard
        title="Pending your review"
        tone="pending"
        helperText="Excluded from the invoice totals above until you approve them."
        items={pendingItems}
        hourlyRateCzk={hourlyRateCzk}
        jiraBaseUrl={jiraBaseUrl}
        defaultCollapsed
      />

      <ItemBreakdownCard
        title="Rejected by client"
        tone="rejected"
        helperText="Excluded from the invoice totals above. Listed here for visibility."
        items={rejectedItems}
        hourlyRateCzk={hourlyRateCzk}
        jiraBaseUrl={jiraBaseUrl}
      />

      <FilterBar
        sort={sort}
        setSort={setSort}
        status={status}
        setStatus={setStatus}
        source={source}
        setSource={setSource}
        query={query}
        setQuery={setQuery}
        hideApproved={hideApproved}
        setHideApproved={setHideApproved}
        projectFilter={projectFilter}
        setProjectFilter={setProjectFilter}
        groupBy={groupBy}
        setGroupBy={setGroupBy}
        projects={projects}
        resultCount={sorted.length}
        totalCount={items.length}
        filteredMinutes={sorted.reduce((s, i) => s + i.workedMinutes, 0)}
        hourlyRateCzk={hourlyRateCzk}
        hasActiveFilters={hasActiveFilters}
        clearAllFilters={clearAllFilters}
      />

      {groups.map((g) => {
        if (g.items.length === 0) return null;
        // Flat mode: no header, no <details> wrapper — just the cards.
        if (g.name === null) {
          return (
            <div key="__flat" className="space-y-3">
              {g.items.map((gi) => (
                <div key={gi.item.id} id={`item-${gi.item.id}`}>
                  <ItemCard
                    item={gi.item}
                    token={token}
                    projects={projects}
                    locked={locked}
                    jiraBaseUrl={jiraBaseUrl}
                    assigned={assignments[gi.item.id] ?? []}
                    onAssignedChange={(next) =>
                      setItemAssignments(gi.item.id, next)
                    }
                    hourlyRateCzk={hourlyRateCzk}
                  />
                </div>
              ))}
            </div>
          );
        }
        const groupMinutes = g.items.reduce((s, gi) => s + gi.minutes, 0);
        const groupCost = minutesToCzk(groupMinutes, hourlyRateCzk);
        const uniqueItemCount = g.items.length;
        // Collapse fully-approved groups on a second pass so the reviewer's
        // attention lands on what still needs work. Stay expanded when the
        // user is explicitly filtering for approved — collapsing then would
        // hide exactly what they asked to see.
        const allApproved = g.items.every((gi) => gi.item.approval === "approved");
        const collapse = allApproved && status !== "approved";
        const open = groupOpenOverride[g.name] ?? !collapse;
        const groupName = g.name;
        return (
          <details
            key={groupName}
            open={open}
            onToggle={(e) => {
              // Read currentTarget.open NOW, not inside the updater — the
              // browser nulls currentTarget once the event handler returns,
              // and React may call the updater asynchronously by then.
              const isOpen = (e.currentTarget as HTMLDetailsElement).open;
              setGroupOpenOverride((prev) => ({
                ...prev,
                [groupName]: isOpen,
              }));
            }}
            className="group space-y-3 [&[open]>summary_.chev]:rotate-90"
          >
            <summary className="list-none cursor-pointer flex items-center gap-2 text-sm font-semibold text-neutral-700 uppercase tracking-wide [&::-webkit-details-marker]:hidden">
              <span
                className="chev text-neutral-400 text-xs transition-transform select-none"
                aria-hidden="true"
              >
                ▶
              </span>
              <span>
                {g.name} · {minutesToHours(groupMinutes)} h ·{" "}
                {groupCost != null && <>{formatCzk(groupCost)} · </>}
                {uniqueItemCount} {uniqueItemCount === 1 ? "item" : "items"}
                {collapse && (
                  <span className="ml-2 normal-case tracking-normal text-green-700 font-medium">
                    all approved ✓
                  </span>
                )}
              </span>
            </summary>
            <div className="space-y-3 mt-3">
              {g.items.map((gi) =>
                gi.primary ? (
                  <div key={gi.item.id} id={`item-${gi.item.id}`}>
                    <ItemCard
                      item={gi.item}
                      token={token}
                      projects={projects}
                      locked={locked}
                      jiraBaseUrl={jiraBaseUrl}
                      assigned={assignments[gi.item.id] ?? []}
                      onAssignedChange={(next) =>
                        setItemAssignments(gi.item.id, next)
                      }
                      hourlyRateCzk={hourlyRateCzk}
                    />
                  </div>
                ) : (
                  <CompactItemRow
                    key={gi.item.id}
                    item={gi.item}
                    splitMinutes={gi.minutes}
                    hourlyRateCzk={hourlyRateCzk}
                    jiraBaseUrl={jiraBaseUrl}
                  />
                ),
              )}
            </div>
          </details>
        );
      })}

      {sorted.length === 0 && (
        <div className="text-sm text-neutral-500 italic text-center py-8">
          No items match the current filter.
        </div>
      )}
    </div>
  );
}

function InvoiceOverview({
  buckets,
  totalMinutes,
  pmMinutes,
  pendingMinutes,
  rejectedMinutes,
  hourlyRateCzk,
}: {
  buckets: Record<string, number>;
  totalMinutes: number;
  pmMinutes: number;
  pendingMinutes: number;
  rejectedMinutes: number;
  hourlyRateCzk: number | null;
}) {
  const totalCost = minutesToCzk(totalMinutes, hourlyRateCzk);

  // <details>/<summary> lets the reviewer collapse the table when they need
  // more screen space. The <summary> line always shows the headline totals
  // so the section stays useful in either state.
  return (
    <details
      open
      className="group bg-white border border-neutral-200 rounded-lg p-5 shadow-sm [&[open]>summary_.chev]:rotate-90"
    >
      <summary className="list-none cursor-pointer flex flex-wrap items-baseline gap-x-3 gap-y-1 [&::-webkit-details-marker]:hidden">
        <span
          className="chev text-neutral-400 text-xs transition-transform select-none"
          aria-hidden="true"
        >
          ▶
        </span>
        <h2 className="text-lg font-semibold">Invoice overview</h2>
        <span className="ml-auto text-sm font-medium text-neutral-800">
          {minutesToHours(totalMinutes)} h
          {totalCost != null && <> · {formatCzk(totalCost)}</>}
          {pendingMinutes > 0 && (
            <span className="ml-2 text-amber-700 font-normal">
              · {minutesToHours(pendingMinutes)} h pending
            </span>
          )}
          {rejectedMinutes > 0 && (
            <span className="ml-2 text-red-700 font-normal">
              · {minutesToHours(rejectedMinutes)} h rejected
            </span>
          )}
        </span>
      </summary>
      <p className="text-sm text-neutral-600 mt-3 mb-3">
        Hours per project for items you&apos;ve <strong>approved</strong>, with
        any multi-project assignments split evenly. Pending and rejected items
        are listed below and don&apos;t count toward the total until approved.
      </p>
      <table className="w-full text-sm">
        <tbody>
          {Object.entries(buckets).map(([name, mins]) => (
            <tr key={name} className="border-t border-neutral-100 first:border-t-0">
              <td className="py-2 text-neutral-700">{name}</td>
              <td className="py-2 text-right font-medium">{minutesToHours(mins)} h</td>
              {hourlyRateCzk != null && (
                <td className="py-2 text-right font-medium text-neutral-600 w-28">
                  {formatCzk(minutesToCzk(mins, hourlyRateCzk))}
                </td>
              )}
            </tr>
          ))}
          <tr className="border-t-2 border-neutral-200">
            <td className="py-2 font-semibold">Total</td>
            <td className="py-2 text-right font-semibold">{minutesToHours(totalMinutes)} h</td>
            {hourlyRateCzk != null && (
              <td className="py-2 text-right font-semibold w-28">
                {formatCzk(totalCost)}
              </td>
            )}
          </tr>
        </tbody>
      </table>
      <div className="mt-3 pt-3 border-t border-neutral-200 space-y-4">
        <ApprovalBreakdownBar
          segments={[
            { key: "approved", label: "Approved", minutes: totalMinutes, tone: "green" },
            { key: "pending", label: "Pending", minutes: pendingMinutes, tone: "amber" },
            { key: "rejected", label: "Rejected", minutes: rejectedMinutes, tone: "red" },
          ]}
          hourlyRateCzk={hourlyRateCzk}
        />
        <PmShareIndicator pmMinutes={pmMinutes} invoiceableMinutes={totalMinutes} />
      </div>
    </details>
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
  hideApproved: boolean;
  setHideApproved: (v: boolean) => void;
  projectFilter: string;
  setProjectFilter: (v: string) => void;
  groupBy: GroupBy;
  setGroupBy: (v: GroupBy) => void;
  projects: Project[];
  resultCount: number;
  totalCount: number;
  filteredMinutes: number;
  hourlyRateCzk: number | null;
  hasActiveFilters: boolean;
  clearAllFilters: () => void;
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
  hideApproved,
  setHideApproved,
  projectFilter,
  setProjectFilter,
  groupBy,
  setGroupBy,
  projects,
  resultCount,
  totalCount,
  filteredMinutes,
  hourlyRateCzk,
  hasActiveFilters,
  clearAllFilters,
}: FilterBarProps) {
  const filteredCost = minutesToCzk(filteredMinutes, hourlyRateCzk);
  const projectName =
    projectFilter === "all"
      ? null
      : projectFilter === "unassigned"
        ? "Unassigned"
        : (projects.find((p) => p.id === projectFilter)?.name ?? projectFilter);
  return (
    <div className="sticky top-2 z-10 bg-white/95 backdrop-blur border border-neutral-200 rounded-lg p-3 space-y-2 shadow-sm">
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="search"
          placeholder="Search key, summary, label…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-[200px] text-sm border border-neutral-300 rounded px-2 py-1"
        />
        <label className="text-xs text-neutral-600 flex items-center gap-1">
          Project
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="border border-neutral-300 rounded px-1.5 py-1 text-sm text-neutral-800"
          >
            <option value="all">All projects</option>
            <option value="unassigned">Unassigned</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-neutral-600 flex items-center gap-1">
          Group by
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
            className="border border-neutral-300 rounded px-1.5 py-1 text-sm text-neutral-800"
          >
            <option value="project">Project</option>
            <option value="status">Status</option>
            <option value="source">Source (JIRA / PM)</option>
            <option value="flat">Flat — no groups</option>
          </select>
        </label>
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
        <button
          type="button"
          onClick={() => setHideApproved(!hideApproved)}
          aria-pressed={hideApproved}
          className={`px-2 py-1 rounded border transition-colors ${
            hideApproved
              ? "bg-neutral-900 text-white border-neutral-900"
              : "bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50"
          }`}
        >
          Hide approved
        </button>
        <div className="ml-auto text-neutral-500 whitespace-nowrap">
          {resultCount === totalCount
            ? `${totalCount} ${totalCount === 1 ? "item" : "items"}`
            : `${resultCount} of ${totalCount} items`}{" "}
          · {minutesToHours(filteredMinutes)} h
          {filteredCost != null && <> · {formatCzk(filteredCost)}</>}
        </div>
      </div>
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-neutral-100 text-xs">
          <span className="text-neutral-500">Active:</span>
          {query.trim() !== "" && (
            <FilterChip label={`Search "${query.trim()}"`} onClear={() => setQuery("")} />
          )}
          {status !== "all" && (
            <FilterChip
              label={`Status: ${capitalize(status)}`}
              onClear={() => setStatus("all")}
            />
          )}
          {source !== "all" && (
            <FilterChip
              label={`Source: ${source === "jira" ? "JIRA" : "PM"}`}
              onClear={() => setSource("all")}
            />
          )}
          {projectFilter !== "all" && projectName && (
            <FilterChip
              label={`Project: ${projectName}`}
              onClear={() => setProjectFilter("all")}
            />
          )}
          {hideApproved && (
            <FilterChip
              label="Hiding approved"
              onClear={() => setHideApproved(false)}
            />
          )}
          <button
            type="button"
            onClick={clearAllFilters}
            className="ml-1 text-neutral-600 hover:text-neutral-900 hover:underline"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 bg-neutral-100 text-neutral-700 rounded px-1.5 py-0.5">
      {label}
      <button
        type="button"
        onClick={onClear}
        className="text-neutral-400 hover:text-neutral-900"
        aria-label={`Remove ${label} filter`}
      >
        ×
      </button>
    </span>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const APPROVAL_DOT: Record<string, { bg: string; label: string }> = {
  approved: { bg: "bg-green-500", label: "Approved" },
  pending: { bg: "bg-amber-400", label: "Pending" },
  rejected: { bg: "bg-red-500", label: "Rejected" },
};

function CompactItemRow({
  item,
  splitMinutes,
  hourlyRateCzk,
  jiraBaseUrl,
}: {
  item: ItemWithAssignments;
  splitMinutes: number;
  hourlyRateCzk: number | null;
  jiraBaseUrl: string | null;
}) {
  const cost = minutesToCzk(splitMinutes, hourlyRateCzk);
  const dot = APPROVAL_DOT[item.approval] ?? APPROVAL_DOT.pending;
  return (
    <div
      className="flex items-center gap-3 px-3 py-2 text-sm bg-neutral-50 border border-dashed border-neutral-300 rounded"
      title="Shared with another project — edit on the original card"
    >
      <span
        className={`inline-block w-2 h-2 rounded-full shrink-0 ${dot.bg}`}
        aria-label={dot.label}
        title={dot.label}
      />
      <span className="font-mono text-xs text-neutral-600 shrink-0 min-w-[3rem]">
        {item.jiraKey ? (
          <JiraLink
            jiraKey={item.jiraKey}
            jiraBaseUrl={jiraBaseUrl}
            className="hover:underline"
          />
        ) : (
          <span className="text-neutral-400">PM</span>
        )}
      </span>
      <span className="flex-1 truncate text-neutral-800">{item.summary}</span>
      <span className="text-xs text-neutral-500 whitespace-nowrap shrink-0">
        {minutesToHours(splitMinutes)} h
        {cost != null && <> · {formatCzk(cost)}</>}
      </span>
      <a
        href={`#item-${item.id}`}
        className="text-xs text-neutral-500 hover:text-neutral-900 hover:underline shrink-0"
        title="Jump to the editable card"
      >
        edit ↑
      </a>
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
            className={`px-2 py-1 transition-colors ${value === v
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
