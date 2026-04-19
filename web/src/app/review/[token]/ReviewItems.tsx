"use client";

import { useMemo, useState } from "react";
import type { Project, ReportItem } from "@prisma/client";

import { minutesToHours } from "@/lib/format";
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
};

type SortKey = "worked-desc" | "worked-asc" | "over" | "under" | "key";
type StatusFilter = "all" | "pending" | "approved" | "rejected";
type SourceFilter = "all" | "jira" | "pm";

export function ReviewItems({ items, projects, token, locked, jiraBaseUrl }: Props) {
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

      {groups.map((g) =>
        g.items.length === 0 ? null : (
          <section key={g.name} className="space-y-3">
            <h2 className="text-sm font-semibold text-neutral-700 uppercase tracking-wide">
              {g.name} ·{" "}
              {minutesToHours(g.items.reduce((s, i) => s + i.workedMinutes, 0))} h ·{" "}
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
                />
              ))}
            </div>
          </section>
        ),
      )}

      {sorted.length === 0 && (
        <div className="text-sm text-neutral-500 italic text-center py-8">
          No items match the current filter.
        </div>
      )}
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
