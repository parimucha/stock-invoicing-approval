"use client";

import { useCallback, useMemo, useState } from "react";
import type { Project, ReportItem } from "@prisma/client";

import { formatCzk, minutesToCzk, minutesToHours } from "@/lib/format";
import { PmShareIndicator } from "@/components/PmShareIndicator";
import { RejectedItemsCard } from "@/components/RejectedItemsCard";
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

  // Rejected items are excluded from invoice totals, per-project buckets,
  // and the PM-share cap — we don't bill for them. They still render in
  // their normal project group below (with the red rejected card border)
  // and are summarized in a dedicated RejectedItemsCard.
  const rejectedItems = useMemo(
    () => items.filter((i) => i.approval === "rejected"),
    [items],
  );
  const billable = useMemo(
    () => items.filter((i) => i.approval !== "rejected"),
    [items],
  );

  const totalMinutes = useMemo(
    () => billable.reduce((s, i) => s + i.workedMinutes, 0),
    [billable],
  );
  const rejectedMinutes = useMemo(
    () => rejectedItems.reduce((s, i) => s + i.workedMinutes, 0),
    [rejectedItems],
  );
  const pmMinutes = useMemo(
    () =>
      billable.reduce(
        (s, i) => (i.source === "project_management" ? s + i.workedMinutes : s),
        0,
      ),
    [billable],
  );
  const buckets = useMemo(() => {
    const b: Record<string, number> = { Unassigned: 0 };
    for (const p of projects) b[p.name] = 0;
    for (const it of billable) {
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
  }, [billable, assignments, projects]);

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

  const groups = useMemo(() => {
    const order = [...projects.map((p) => p.name), "Unassigned"];
    const map = new Map<string, ItemWithAssignments[]>();
    for (const name of order) map.set(name, []);
    for (const it of sorted) {
      const suggested = it.suggestedProjects as string[];
      const firstProjectName =
        suggested.length === 0
          ? "Unassigned"
          : (projects.find((p) => p.id === suggested[0])?.name ?? "Unassigned");
      const bucket = map.get(firstProjectName) ?? map.get("Unassigned")!;
      bucket.push(it);
    }
    return order.map((name) => ({ name, items: map.get(name) ?? [] }));
  }, [sorted, projects]);

  return (
    <div className="space-y-6">
      <InvoiceOverview
        buckets={buckets}
        totalMinutes={totalMinutes}
        pmMinutes={pmMinutes}
        rejectedMinutes={rejectedMinutes}
        hourlyRateCzk={hourlyRateCzk}
      />

      <RejectedItemsCard
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
        resultCount={sorted.length}
        totalCount={items.length}
      />

      {groups.map((g) => {
        if (g.items.length === 0) return null;
        const groupMinutes = g.items.reduce((s, i) => s + i.workedMinutes, 0);
        const groupCost = minutesToCzk(groupMinutes, hourlyRateCzk);
        return (
          <section key={g.name} className="space-y-3">
            <h2 className="text-sm font-semibold text-neutral-700 uppercase tracking-wide">
              {g.name} · {minutesToHours(groupMinutes)} h ·{" "}
              {groupCost != null && <>{formatCzk(groupCost)} · </>}
              {g.items.length} {g.items.length === 1 ? "item" : "items"}
            </h2>
            <div className="space-y-3">
              {g.items.map((it) => (
                <ItemCard
                  key={it.id}
                  item={it}
                  token={token}
                  projects={projects}
                  locked={locked}
                  jiraBaseUrl={jiraBaseUrl}
                  assigned={assignments[it.id] ?? []}
                  onAssignedChange={(next) => setItemAssignments(it.id, next)}
                  hourlyRateCzk={hourlyRateCzk}
                />
              ))}
            </div>
          </section>
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
  rejectedMinutes,
  hourlyRateCzk,
}: {
  buckets: Record<string, number>;
  totalMinutes: number;
  pmMinutes: number;
  rejectedMinutes: number;
  hourlyRateCzk: number | null;
}) {
  const [collapsed, setCollapsed] = useState(false);

  // Re-attach the observer every time React mounts a different <section>
  // element (the conditional below renders distinct nodes for the
  // expanded/collapsed branches). A useEffect with [] would observe the
  // initial node forever and stop firing once that node is unmounted —
  // visible in MS Edge as a sticky bar that gets stuck collapsed and never
  // reflects scroll-back-to-top. Pairs with `overflow-anchor: none` in
  // globals.css, which prevents the height-change oscillation loop.
  const sectionRef = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setCollapsed(entry.intersectionRatio < 1),
      { threshold: [1], rootMargin: "-9px 0px 0px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const pmPct = totalMinutes > 0 ? (pmMinutes / totalMinutes) * 100 : 0;
  const pmOver = pmPct > 20;
  const totalCost = minutesToCzk(totalMinutes, hourlyRateCzk);

  if (collapsed) {
    return (
      <section
        ref={sectionRef}
        className="sticky top-2 z-10 bg-white/95 backdrop-blur border border-neutral-200 rounded-lg shadow-sm"
      >
        <div className="px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {Object.entries(buckets).map(([name, mins]) => {
            const cost = minutesToCzk(mins, hourlyRateCzk);
            return (
              <span key={name}>
                <span className="text-neutral-500">{name}</span>{" "}
                <span className="font-medium text-neutral-800">
                  {minutesToHours(mins)} h
                </span>
                {cost != null && (
                  <span className="text-neutral-500"> · {formatCzk(cost)}</span>
                )}
              </span>
            );
          })}
          <span className="text-neutral-300" aria-hidden="true">
            ·
          </span>
          <span
            className={`font-medium ${pmOver ? "text-red-700" : "text-green-700"}`}
          >
            PM {pmPct.toFixed(1)}% {pmOver ? "⚠" : "✓"}
          </span>
          <span className="text-neutral-300" aria-hidden="true">
            ·
          </span>
          <span className="font-semibold">
            Total {minutesToHours(totalMinutes)} h
            {totalCost != null && <> · {formatCzk(totalCost)}</>}
          </span>
          {rejectedMinutes > 0 && (
            <>
              <span className="text-neutral-300" aria-hidden="true">
                ·
              </span>
              <span className="text-red-700 font-medium">
                {minutesToHours(rejectedMinutes)} h rejected
              </span>
            </>
          )}
        </div>
      </section>
    );
  }

  return (
    <section
      ref={sectionRef}
      className="sticky top-2 z-10 bg-white/95 backdrop-blur border border-neutral-200 rounded-lg p-5 shadow-sm"
    >
      <h2 className="text-lg font-semibold mb-3">Invoice overview</h2>
      <p className="text-sm text-neutral-600 mb-3">
        Hours per project based on current assignments. Items assigned to multiple projects
        are split evenly.
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
      <div className="mt-3 pt-3 border-t border-neutral-200">
        <PmShareIndicator pmMinutes={pmMinutes} invoiceableMinutes={totalMinutes} />
      </div>
    </section>
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
