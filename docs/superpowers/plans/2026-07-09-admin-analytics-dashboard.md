# Admin Analytics Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only `/admin/analytics` dashboard showing worked time per project per month as a stacked bar chart, with report checkboxes, a project filter, and live per-project totals.

**Architecture:** A pure, unit-tested attribution helper (`lib/analytics.ts`) turns Prisma report data into a `{ reports, projects, minutes }` matrix (even-split for multi-project items, an "Unassigned" bucket for untagged ones). A server component (`admin/analytics/page.tsx`) runs the Prisma query, calls the helper, and passes the JSON-safe matrix to a `"use client"` dashboard (`AnalyticsDashboard.tsx`) that owns all filtering, totals, and the Recharts stacked bar chart.

**Tech Stack:** Next.js 16.2.4 (App Router, RSC), React 19.2.4, Prisma/Postgres, Tailwind v4, Recharts v3 (charting), vitest (unit tests).

## Global Constraints

- **This is NOT stock Next.js.** Per [`web/AGENTS.md`](../../../web/AGENTS.md), Next 16.2.4 has breaking changes. Before writing the client/server components, read `web/node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` and `web/node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md`.
- **All commands run from the `web/` directory** (the Next app lives in `web/`, not repo root).
- **Path alias:** `@/` → `web/src/`. Import the Prisma client as `import { prisma } from "@/lib/prisma"`.
- **Admin auth** is enforced by [`web/src/app/admin/layout.tsx`](../../../web/src/app/admin/layout.tsx) (`isAdmin()` redirect). Any page under `src/app/admin/` is automatically protected — no per-page auth needed.
- **vitest env is `node`** (see [`web/vitest.config.ts`](../../../web/vitest.config.ts)); tests match `src/**/*.test.ts`. There is no jsdom/testing-library, so React components are NOT unit-tested — they are gated by `npx tsc --noEmit` + `npm run lint`, then visually verified in the browser by the user.
- **Do not start the dev server yourself** — after the final task, ask the user to run `npm run dev` and open `/admin/analytics` to verify visually.
- **Styling:** match existing admin pages — white cards, `border-neutral-200`, `rounded-lg`, neutral text, `text-sm`. See [`web/src/app/admin/page.tsx`](../../../web/src/app/admin/page.tsx).
- **Every commit message ends with the trailer:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Work happens on the existing branch `feat/admin-analytics-dashboard`.

---

## File Structure

- **Create** `web/src/lib/analytics.ts` — pure attribution/matrix builder. Responsibility: turn report+item+assignment data into the chart matrix. No React, no Prisma.
- **Create** `web/src/lib/analytics.test.ts` — vitest unit tests for the helper.
- **Create** `web/src/app/admin/analytics/AnalyticsDashboard.tsx` — `"use client"` interactive UI (filters, totals, chart).
- **Create** `web/src/app/admin/analytics/page.tsx` — server component (Prisma query → helper → dashboard).
- **Modify** `web/src/app/admin/layout.tsx` — add "Analytics" nav link.
- **Modify** `web/package.json` (+ lockfile) — add `recharts` and `react-is`.

---

## Task 1: Attribution helper (`lib/analytics.ts`)

**Files:**
- Create: `web/src/lib/analytics.ts`
- Test: `web/src/lib/analytics.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `const UNASSIGNED_ID = "__unassigned__"` and `const UNASSIGNED_NAME = "Unassigned"`.
  - `type AnalyticsItem = { workedMinutes: number; assignments: { projectId: string; project: { name: string } }[] }`
  - `type AnalyticsReportInput = { id: number; label: string; items: AnalyticsItem[] }`
  - `type AnalyticsProject = { id: string; name: string }`
  - `type AnalyticsMatrix = { reports: { id: number; label: string }[]; projects: AnalyticsProject[]; minutes: Record<number, Record<string, number>> }`
  - `function buildProjectTimeMatrix(reports: AnalyticsReportInput[]): AnalyticsMatrix`

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/analytics.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildProjectTimeMatrix,
  UNASSIGNED_ID,
  type AnalyticsReportInput,
} from "./analytics";

function report(
  id: number,
  label: string,
  items: AnalyticsReportInput["items"],
): AnalyticsReportInput {
  return { id, label, items };
}

describe("buildProjectTimeMatrix", () => {
  it("assigns all minutes to a single-project item", () => {
    const m = buildProjectTimeMatrix([
      report(1, "2026-01", [
        { workedMinutes: 60, assignments: [{ projectId: "p1", project: { name: "Alpha" } }] },
      ]),
    ]);
    expect(m.minutes[1].p1).toBe(60);
    expect(m.projects).toEqual([{ id: "p1", name: "Alpha" }]);
    expect(m.reports).toEqual([{ id: 1, label: "2026-01" }]);
  });

  it("splits minutes evenly across multiple projects", () => {
    const m = buildProjectTimeMatrix([
      report(1, "2026-01", [
        {
          workedMinutes: 60,
          assignments: [
            { projectId: "p1", project: { name: "Alpha" } },
            { projectId: "p2", project: { name: "Beta" } },
          ],
        },
      ]),
    ]);
    expect(m.minutes[1].p1).toBe(30);
    expect(m.minutes[1].p2).toBe(30);
  });

  it("splits sum back to the item's total minutes (no double counting)", () => {
    const m = buildProjectTimeMatrix([
      report(1, "2026-01", [
        {
          workedMinutes: 100,
          assignments: [
            { projectId: "p1", project: { name: "Alpha" } },
            { projectId: "p2", project: { name: "Beta" } },
            { projectId: "p3", project: { name: "Gamma" } },
          ],
        },
      ]),
    ]);
    const sum = m.minutes[1].p1 + m.minutes[1].p2 + m.minutes[1].p3;
    expect(sum).toBeCloseTo(100, 10);
  });

  it("routes unassigned items to the Unassigned bucket", () => {
    const m = buildProjectTimeMatrix([
      report(1, "2026-01", [{ workedMinutes: 45, assignments: [] }]),
    ]);
    expect(m.minutes[1][UNASSIGNED_ID]).toBe(45);
    expect(m.projects).toEqual([{ id: UNASSIGNED_ID, name: "Unassigned" }]);
  });

  it("gives a zero-item report an empty column and no projects", () => {
    const m = buildProjectTimeMatrix([report(1, "2026-01", [])]);
    expect(m.minutes[1]).toEqual({});
    expect(m.projects).toEqual([]);
  });

  it("preserves each report's total minutes across projects", () => {
    const m = buildProjectTimeMatrix([
      report(1, "2026-01", [
        {
          workedMinutes: 60,
          assignments: [
            { projectId: "p1", project: { name: "Alpha" } },
            { projectId: "p2", project: { name: "Beta" } },
          ],
        },
        { workedMinutes: 30, assignments: [{ projectId: "p1", project: { name: "Alpha" } }] },
        { workedMinutes: 15, assignments: [] },
      ]),
    ]);
    const total = Object.values(m.minutes[1]).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(105, 10);
  });

  it("sorts real projects by name and puts Unassigned last", () => {
    const m = buildProjectTimeMatrix([
      report(1, "2026-01", [
        { workedMinutes: 10, assignments: [{ projectId: "pz", project: { name: "Zeta" } }] },
        { workedMinutes: 10, assignments: [{ projectId: "pa", project: { name: "Alpha" } }] },
        { workedMinutes: 10, assignments: [] },
      ]),
    ]);
    expect(m.projects.map((p) => p.name)).toEqual(["Alpha", "Zeta", "Unassigned"]);
  });

  it("keeps one row per report keyed by report id", () => {
    const m = buildProjectTimeMatrix([
      report(3, "2026-03", [{ workedMinutes: 20, assignments: [{ projectId: "p1", project: { name: "Alpha" } }] }]),
      report(2, "2026-02", []),
    ]);
    expect(Object.keys(m.minutes).sort()).toEqual(["2", "3"]);
    expect(m.reports).toEqual([
      { id: 3, label: "2026-03" },
      { id: 2, label: "2026-02" },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/lib/analytics.test.ts`
Expected: FAIL — `Failed to resolve import "./analytics"` (module does not exist yet).

- [ ] **Step 3: Implement the helper**

Create `web/src/lib/analytics.ts`:

```ts
// Pure attribution helper: turns report/item/assignment data into a
// per-report × per-project minute matrix for the analytics dashboard.
// No React, no Prisma — unit-testable in isolation.

export const UNASSIGNED_ID = "__unassigned__";
export const UNASSIGNED_NAME = "Unassigned";

export type AnalyticsItem = {
  workedMinutes: number;
  assignments: { projectId: string; project: { name: string } }[];
};

export type AnalyticsReportInput = {
  id: number;
  label: string;
  items: AnalyticsItem[];
};

export type AnalyticsProject = { id: string; name: string };

export type AnalyticsMatrix = {
  /** Reports in the order given (caller sorts chronologically). */
  reports: { id: number; label: string }[];
  /** Real projects sorted by name, then Unassigned last (only if it has minutes). */
  projects: AnalyticsProject[];
  /** minutes[reportId][projectId] — attributed minutes (float; round at display). */
  minutes: Record<number, Record<string, number>>;
};

export function buildProjectTimeMatrix(
  reports: AnalyticsReportInput[],
): AnalyticsMatrix {
  const minutes: Record<number, Record<string, number>> = {};
  const projectNames = new Map<string, string>();
  let unassignedTotal = 0;

  for (const report of reports) {
    const row: Record<string, number> = {};
    for (const item of report.items) {
      if (item.assignments.length === 0) {
        row[UNASSIGNED_ID] = (row[UNASSIGNED_ID] ?? 0) + item.workedMinutes;
        unassignedTotal += item.workedMinutes;
        continue;
      }
      const share = item.workedMinutes / item.assignments.length;
      for (const a of item.assignments) {
        row[a.projectId] = (row[a.projectId] ?? 0) + share;
        projectNames.set(a.projectId, a.project.name);
      }
    }
    minutes[report.id] = row;
  }

  const projects: AnalyticsProject[] = [...projectNames.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (unassignedTotal > 0) {
    projects.push({ id: UNASSIGNED_ID, name: UNASSIGNED_NAME });
  }

  return {
    reports: reports.map((r) => ({ id: r.id, label: r.label })),
    projects,
    minutes,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/lib/analytics.test.ts`
Expected: PASS — 8 passing tests.

- [ ] **Step 5: Commit**

```bash
cd web && git add src/lib/analytics.ts src/lib/analytics.test.ts && git commit -m "$(cat <<'EOF'
Add analytics attribution helper

buildProjectTimeMatrix: even-split minutes across multi-project items,
Unassigned bucket for untagged items, per-report×project matrix.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Client dashboard component (`AnalyticsDashboard.tsx`)

**Files:**
- Create: `web/src/app/admin/analytics/AnalyticsDashboard.tsx`
- Modify: `web/package.json` + `web/package-lock.json` (add `recharts`, `react-is`)

**Interfaces:**
- Consumes: `AnalyticsMatrix`, `UNASSIGNED_ID` from `@/lib/analytics` (Task 1).
- Produces: `export default function AnalyticsDashboard({ matrix }: { matrix: AnalyticsMatrix })` — the page's client subtree.

- [ ] **Step 1: Read the Next.js client-component docs**

Read `web/node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md` and confirm the `"use client"` directive convention and that serializable props (our plain `AnalyticsMatrix` object) may cross the server→client boundary.

- [ ] **Step 2: Install Recharts**

Run: `cd web && npm install recharts react-is`
Expected: `recharts` (v3.x) and `react-is` added to `package.json` dependencies; no peer-dependency errors against React 19.

- [ ] **Step 3: Write the component**

Create `web/src/app/admin/analytics/AnalyticsDashboard.tsx`:

```tsx
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

// Stable categorical palette. (During execution, load the `dataviz` skill and
// reconcile these hexes with its categorical palette — the structure is
// unchanged, only the values may be swapped.)
const PALETTE = [
  "#2563eb", "#16a34a", "#f59e0b", "#db2777", "#7c3aed",
  "#0891b2", "#dc2626", "#65a30d", "#c026d3", "#ea580c",
];
const UNASSIGNED_COLOR = "#9ca3af"; // neutral-400

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
                  formatter={(value: number, name: string) => [`${value} h`, name]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {shownProjects.map((p, i) => (
                  <Bar
                    key={p.id}
                    dataKey={`s${i}`}
                    name={p.name}
                    stackId="h"
                    fill={colorByProject.get(p.id)}
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
```

- [ ] **Step 4: Typecheck and lint**

Run: `cd web && npx tsc --noEmit && npm run lint`
Expected: no type errors, no lint errors. (The file is a client component; it is not rendered anywhere yet — that happens in Task 3. This step only proves it compiles.)

- [ ] **Step 5: Commit**

```bash
cd web && git add package.json package-lock.json src/app/admin/analytics/AnalyticsDashboard.tsx && git commit -m "$(cat <<'EOF'
Add analytics dashboard client component

Recharts stacked bars per month, report/project checkboxes with
all/none, live per-project totals and grand total.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Server page + nav link (wire it up)

**Files:**
- Create: `web/src/app/admin/analytics/page.tsx`
- Modify: `web/src/app/admin/layout.tsx`

**Interfaces:**
- Consumes: `buildProjectTimeMatrix` from `@/lib/analytics` (Task 1); `AnalyticsDashboard` default export from `./AnalyticsDashboard` (Task 2).
- Produces: the `/admin/analytics` route.

- [ ] **Step 1: Write the server page**

Create `web/src/app/admin/analytics/page.tsx`:

```tsx
import { prisma } from "@/lib/prisma";
import { buildProjectTimeMatrix } from "@/lib/analytics";
import AnalyticsDashboard from "./AnalyticsDashboard";

export default async function AnalyticsPage() {
  const reports = await prisma.report.findMany({
    orderBy: { periodStart: "asc" },
    select: {
      id: true,
      label: true,
      items: {
        select: {
          workedMinutes: true,
          assignments: {
            select: { projectId: true, project: { select: { name: true } } },
          },
        },
      },
    },
  });

  const matrix = buildProjectTimeMatrix(reports);
  return <AnalyticsDashboard matrix={matrix} />;
}
```

Note: the Prisma `select` returns exactly `AnalyticsReportInput[]` (`id`, `label`, `items[].workedMinutes`, `items[].assignments[].projectId`, `items[].assignments[].project.name`). `periodStart` is used only for `orderBy` and is not selected. If `tsc` reports a shape mismatch, align the `select` with `AnalyticsReportInput` — do not loosen the helper's types.

- [ ] **Step 2: Add the nav link**

In `web/src/app/admin/layout.tsx`, add the Analytics link to the `<nav>` block, immediately after the existing Upload link (around line 26–28):

```tsx
              <Link href="/admin/upload" className="hover:text-neutral-900">
                Upload
              </Link>
              <Link href="/admin/analytics" className="hover:text-neutral-900">
                Analytics
              </Link>
```

- [ ] **Step 3: Typecheck, lint, and run the full test suite**

Run: `cd web && npx tsc --noEmit && npm run lint && npm test`
Expected: no type/lint errors; vitest reports all tests passing (including Task 1's `analytics.test.ts`).

- [ ] **Step 4: Commit**

```bash
cd web && git add src/app/admin/analytics/page.tsx src/app/admin/layout.tsx && git commit -m "$(cat <<'EOF'
Wire up /admin/analytics route

Server component queries reports+items+assignments, builds the matrix,
renders the dashboard; adds Analytics nav link.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Ask the user to verify in the browser**

Do NOT start the dev server yourself. Ask the user to run `cd web && npm run dev`, open `http://localhost:3000/admin/analytics` (signing in if prompted), and confirm:
- stacked bars appear, one per report/month, chronological left→right;
- unchecking a report removes its bar; unchecking a project removes that colour from every bar and from the totals;
- per-project totals + grand total match the chart and update on toggle;
- "Unassigned" (grey) shows only if there is untagged time.

---

## Self-Review

**Spec coverage:**
- Admin-only `/admin/analytics` page → Task 3 (route under `admin/`, protected by existing layout auth) + Task 2 (UI). ✓
- Stacked bars per month → Task 2 (`Bar ... stackId="h"`). ✓
- Select which reports (checkbox each) → Task 2 (Reports panel). ✓
- Filter which projects → Task 2 (Projects panel). ✓
- Per-project overall totals + grand total → Task 2 (`projectTotals`, `grandTotalMin`). ✓
- Even-split attribution + Unassigned bucket → Task 1 (`buildProjectTimeMatrix`) + tests. ✓
- All reports/projects selected by default → Task 2 (initial `Set` state). ✓
- Recharts library → Task 2 (install + chart). ✓
- Nav link → Task 3. ✓
- vitest unit tests for the helper → Task 1. ✓
- Colours (stable per project, muted Unassigned) → Task 2 (`colorByProject`, `UNASSIGNED_COLOR`). ✓

**Placeholder scan:** No TBD/TODO; all code blocks are complete; palette hexes are concrete (with a reconciliation note, not a placeholder). ✓

**Type consistency:** `buildProjectTimeMatrix`, `AnalyticsMatrix`, `UNASSIGNED_ID`, `AnalyticsReportInput` names match across Tasks 1→2→3. The Prisma `select` in Task 3 matches `AnalyticsReportInput`. Chart series use `s{i}` aliases mapped from `shownProjects`; colours keyed by real `p.id`. ✓
