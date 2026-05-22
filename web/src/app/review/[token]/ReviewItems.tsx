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
  }, [items, status, source, query, hideApproved]);

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

  // Grouping follows the reviewer's live project checkboxes (assignments),
  // not the upload-time suggestedProjects. An item assigned to N projects
  // appears in each of those groups, with its worked time split N ways
  // (matching the invoice overview math). Within a group, the item shows as
  // a full editable card in its "primary" location — the lowest-sortOrder
  // assigned project — and as a compact read-only row elsewhere. This
  // duplicates visibility without duplicating editable state.
  const groups = useMemo(() => {
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
      for (const pid of assigned) {
        const projectName = projectNameById.get(pid) ?? "Unassigned";
        map.get(projectName)?.push({
          item: it,
          minutes: share,
          primary: projectName === primaryName,
        });
      }
    }
    return order.map((name) => ({ name, items: map.get(name) ?? [] }));
  }, [sorted, projects, assignments]);

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
        resultCount={sorted.length}
        totalCount={items.length}
      />

      {groups.map((g) => {
        if (g.items.length === 0) return null;
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
        return (
          <details
            key={g.name}
            open={open}
            onToggle={(e) => {
              // Read currentTarget.open NOW, not inside the updater — the
              // browser nulls currentTarget once the event handler returns,
              // and React may call the updater asynchronously by then.
              const isOpen = (e.currentTarget as HTMLDetailsElement).open;
              setGroupOpenOverride((prev) => ({
                ...prev,
                [g.name]: isOpen,
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
          {pendingMinutes > 0 && (
            <>
              <span className="text-neutral-300" aria-hidden="true">
                ·
              </span>
              <span className="text-amber-700 font-medium">
                {minutesToHours(pendingMinutes)} h pending
              </span>
            </>
          )}
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
  hideApproved: boolean;
  setHideApproved: (v: boolean) => void;
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
  hideApproved,
  setHideApproved,
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
        <div className="ml-auto text-neutral-500">
          {resultCount === totalCount
            ? `${totalCount} ${totalCount === 1 ? "item" : "items"}`
            : `${resultCount} of ${totalCount} items`}
        </div>
      </div>
    </div>
  );
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
