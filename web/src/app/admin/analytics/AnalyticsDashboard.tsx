"use client";

import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { UNASSIGNED_ID, type AnalyticsMatrix } from "@/lib/analytics";

// Validated categorical palette from the `dataviz` skill — light-mode slots
// 1–8 in fixed order (the ordering IS the CVD-safety mechanism; do not
// reorder). Passes CVD (worst adjacent ΔE 24.2); the aqua/yellow/magenta
// sub-3:1 contrast WARN is relieved by the always-present Projects panel
// (labeled swatch + name + total) plus the legend and tooltips.
const PALETTE = [
  "#2a78d6", // 1 blue
  "#1baf7a", // 2 aqua
  "#eda100", // 3 yellow
  "#008300", // 4 green
  "#4a3aa7", // 5 violet
  "#e34948", // 6 red
  "#e87ba4", // 7 magenta
  "#eb6834", // 8 orange
];
const UNASSIGNED_COLOR = "#9ca3af"; // neutral gray — reads as "not a project"

function toHours(min: number): number {
  return Math.round((min / 60) * 10) / 10;
}

export default function AnalyticsDashboard({ matrix }: { matrix: AnalyticsMatrix }) {
  const { reports, projects, minutes } = matrix;

  const [selectedReports, setSelectedReports] = useState<Set<number>>(
    () => new Set(reports.map((r) => r.id)),
  );
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(
    () => new Set(projects.map((p) => p.id)),
  );

  // Stable color per project by full-list index (Unassigned always grey), so a
  // project keeps its color no matter which others are toggled off.
  const colorByProject = useMemo(() => {
    const map = new Map<string, string>();
    let i = 0;
    for (const p of projects) {
      if (p.id === UNASSIGNED_ID) {
        map.set(p.id, UNASSIGNED_COLOR);
      } else {
        map.set(p.id, PALETTE[i % PALETTE.length]);
        i++;
      }
    }
    return map;
  }, [projects]);

  const shownReports = reports.filter((r) => selectedReports.has(r.id));
  const shownProjects = projects.filter((p) => selectedProjects.has(p.id));

  // One chart row per shown report. Series keyed s0..sN (aliases, so arbitrary
  // project ids with dots can't be misread by Recharts as nested paths).
  const chartData = useMemo(() => {
    return shownReports.map((r) => {
      const row: Record<string, number | string> = { label: r.label };
      shownProjects.forEach((p, i) => {
        row[`s${i}`] = toHours(minutes[r.id]?.[p.id] ?? 0);
      });
      return row;
    });
  }, [shownReports, shownProjects, minutes]);

  // Per-project totals (minutes) across the selected reports.
  const projectTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const p of projects) {
      let sum = 0;
      for (const r of shownReports) sum += minutes[r.id]?.[p.id] ?? 0;
      totals.set(p.id, sum);
    }
    return totals;
  }, [projects, shownReports, minutes]);

  const grandTotalMin = shownProjects.reduce(
    (s, p) => s + (projectTotals.get(p.id) ?? 0),
    0,
  );

  function toggleReport(id: number) {
    setSelectedReports((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleProject(id: string) {
    setSelectedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Analytics</h1>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_18rem] gap-6">
        {/* Chart */}
        <div className="bg-white border border-neutral-200 rounded-lg p-4">
          {shownReports.length === 0 ? (
            <Empty msg="Select at least one report." />
          ) : shownProjects.length === 0 ? (
            <Empty msg="Select at least one project." />
          ) : (
            <ResponsiveContainer width="100%" height={420}>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis width={44} tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value, name) => [`${value ?? 0} h`, name ?? ""]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {shownProjects.map((p, i) => (
                  <Bar
                    key={p.id}
                    dataKey={`s${i}`}
                    name={p.name}
                    stackId="h"
                    fill={colorByProject.get(p.id)}
                    stroke="#ffffff"
                    strokeWidth={1}
                    radius={i === shownProjects.length - 1 ? [3, 3, 0, 0] : 0}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Controls */}
        <div className="space-y-6">
          <Panel
            title="Projects"
            onAll={() => setSelectedProjects(new Set(projects.map((p) => p.id)))}
            onNone={() => setSelectedProjects(new Set())}
          >
            <ul className="space-y-1">
              {projects.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedProjects.has(p.id)}
                    onChange={() => toggleProject(p.id)}
                  />
                  <span
                    className="inline-block w-3 h-3 rounded-sm shrink-0"
                    style={{ background: colorByProject.get(p.id) }}
                  />
                  <span className="flex-1 truncate">{p.name}</span>
                  <span className="tabular-nums text-neutral-600">
                    {toHours(projectTotals.get(p.id) ?? 0)} h
                  </span>
                </li>
              ))}
            </ul>
            <div className="border-t border-neutral-200 mt-2 pt-2 flex justify-between text-sm font-medium">
              <span>Total ({shownProjects.length})</span>
              <span className="tabular-nums">{toHours(grandTotalMin)} h</span>
            </div>
          </Panel>

          <Panel
            title="Reports"
            onAll={() => setSelectedReports(new Set(reports.map((r) => r.id)))}
            onNone={() => setSelectedReports(new Set())}
          >
            <ul className="space-y-1">
              {reports.map((r) => {
                const totalMin = Object.values(minutes[r.id] ?? {}).reduce(
                  (s, v) => s + v,
                  0,
                );
                return (
                  <li key={r.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedReports.has(r.id)}
                      onChange={() => toggleReport(r.id)}
                    />
                    <span className="flex-1">{r.label}</span>
                    <span className="tabular-nums text-neutral-600">
                      {toHours(totalMin)} h
                    </span>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="h-[420px] flex items-center justify-center text-sm text-neutral-500">
      {msg}
    </div>
  );
}

function Panel({
  title,
  onAll,
  onNone,
  children,
}: {
  title: string;
  onAll: () => void;
  onNone: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-neutral-200 rounded-lg p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="text-xs text-neutral-500 flex gap-2">
          <button type="button" onClick={onAll} className="hover:text-neutral-900 underline">
            all
          </button>
          <button type="button" onClick={onNone} className="hover:text-neutral-900 underline">
            none
          </button>
        </div>
      </div>
      {children}
    </section>
  );
}
