# Admin analytics dashboard — design

**Date:** 2026-07-09
**Status:** Approved (design), pending implementation plan
**Area:** `web/` — PORTA admin

## Problem

PORTA has monthly reports, each a bag of work items with `workedMinutes`, and
items are tagged to one or more **Projects** via the `ProjectAssignment` join
table. Today there is no way to see **worked time per project across months** —
the admin home ([`web/src/app/admin/page.tsx`](../../../web/src/app/admin/page.tsx))
lists reports with total hours, and the report detail page shows per-item project
tags, but nothing aggregates hours-by-project over time.

We want an internal analytics view that answers "how much time went into each
project, month over month?" with the ability to include/exclude specific reports
and filter which projects are shown.

## Goals

- A single admin-only dashboard showing **time worked per project, per month**,
  as a stacked bar chart (one bar per report/month, projects stacked within).
- **Select which reports** to include via a checkbox per report.
- **Filter which projects** to show via a checkbox per project.
- Show **per-project overall totals** (summed across the selected reports) and a
  grand total, updating live as reports/projects are toggled.

## Non-goals (YAGNI)

- Client-facing / magic-token version. Admin-only for now; a shareable read-only
  surface can be added later.
- Grouped bars, line charts, or a chart-type switcher. Stacked bars only.
- Cost/revenue analytics (CZK). This is a **time** dashboard; cost lives on the
  report pages already.
- Per-person, per-Jira-status, or per-item-type breakdowns. Project × month only.
- Date-range pickers or custom period grouping. Reports are already monthly; the
  report checkboxes are the time selector.
- Top-N / "Others" bucketing of projects. If the project list ever gets long,
  that is a follow-up; the select-all/none controls suffice for now.

## Decisions (from brainstorming)

1. **Placement:** New admin-only page at `/admin/analytics`, behind the existing
   admin auth, with an "Analytics" link added to the admin layout nav.
2. **Attribution (multi-project items):** An item's `workedMinutes` is **split
   evenly** across its assigned projects (e.g. 60 min on 2 projects → 30 min
   each). This keeps monthly totals honest — the splits sum back to the report's
   real hours, no double counting. (The join table has no weights, so even split
   is the only proportional option the data supports.)
3. **Unassigned items:** Items with **no** project assignment are collected into a
   synthetic **"Unassigned"** bucket, shown as its own series/row. Nothing is
   hidden; it surfaces tagging gaps.
4. **Chart shape:** **Stacked bars per month.** X = selected months
   (chronological), Y = hours, one stacked segment per selected project.
5. **Charting library:** **Recharts.** The requested interactivity (toggle
   months, filter project series, hover tooltips, legend) is native to it, so
   effort goes into attribution/data logic rather than reinventing chart
   primitives. Compatibility with React 19 / Next 16 is verified during
   implementation; if it does not work cleanly, fall back to a hand-rolled SVG
   stacked bar chart (same data contract, so only the chart component changes).
6. **Defaults:** On first load, **all reports and all projects are selected.**

## Architecture

Server component loads and shapes the data; a client component owns all
interactivity. The dataset is small (a handful of reports, hundreds of items at
most), so everything is loaded once server-side and filtered client-side — no API
route, no per-toggle refetch.

### 1. Attribution logic — `web/src/lib/analytics.ts` (pure, tested)

A pure function with no Prisma/React dependency, so it is unit-testable in
isolation (matching the existing `report-backup.ts` / `report-backup.test.ts`
pattern).

```ts
const UNASSIGNED_ID = "__unassigned__";

type AnalyticsInput = {
  id: number;
  label: string;
  periodStart: Date;
  items: {
    workedMinutes: number;
    assignments: { projectId: string; project: { name: string } }[];
  }[];
}[];

type AnalyticsMatrix = {
  reports: { id: number; label: string }[];              // chronological (periodStart asc)
  projects: { id: string; name: string }[];              // real projects (sorted by name) + Unassigned last
  // minutes[reportId][projectId] = attributed minutes (float; rounded to hours at display)
  minutes: Record<number, Record<string, number>>;
};

function buildProjectTimeMatrix(reports: AnalyticsInput): AnalyticsMatrix;
```

Algorithm — for each report, for each item:
- `assignments.length === 0` → add all `workedMinutes` to `UNASSIGNED_ID`.
- otherwise → `share = workedMinutes / assignments.length`; add `share` to each
  assigned `projectId`.

Minutes accumulate as floats (no rounding until display), so
`sum over projects of minutes[reportId][*]` equals the report's total
`workedMinutes` exactly. `projects[]` contains every project that receives
minutes in at least one report (plus Unassigned if any unassigned minutes
exist), each carrying its current `Project.name`. (The matrix is built over all
reports; report/project *selection* happens client-side.) The
"Unassigned" pseudo-project uses `id = UNASSIGNED_ID` and `name = "Unassigned"`
and always sorts last.

### 2. Page — `web/src/app/admin/analytics/page.tsx` (server component)

- Prisma query:
  ```ts
  prisma.report.findMany({
    orderBy: { periodStart: "asc" },
    select: {
      id: true, label: true, periodStart: true,
      items: {
        select: {
          workedMinutes: true,
          assignments: { select: { projectId: true, project: { select: { name: true } } } },
        },
      },
    },
  })
  ```
- All reports are included regardless of `status` (internal tool; draft included).
- Call `buildProjectTimeMatrix(reports)`, then pass the serializable
  `AnalyticsMatrix` (Dates already reduced to `label`, so the payload is
  JSON-safe) to the client component.

### 3. Client component — `web/src/app/admin/analytics/AnalyticsDashboard.tsx` (`"use client"`)

Props: the `AnalyticsMatrix`.

State:
- `selectedReportIds: Set<number>` — initialised to all report ids.
- `selectedProjectIds: Set<string>` — initialised to all project ids (incl. Unassigned).

Derived (memoised):
- **Chart data**: for each selected report (chronological), a row
  `{ label, [projectId]: hours, ... }` limited to selected projects; minutes→hours
  via `min / 60` (rounded to 1 decimal for display, matching `minutesToHours`).
- **Per-project totals**: for each project, sum of its minutes across the
  **selected** reports → hours. **Grand total** = sum across selected projects.

UI layout:
- **Reports panel** — checkbox per report (`label` + that report's total hours),
  with select-all / select-none. Controls which bars appear on the X axis.
- **Projects panel** — checkbox per project, each row = colour swatch + name +
  its overall total hours (across selected reports); select-all / select-none;
  footer row with project count + grand total. Doubles as legend + totals table.
- **Chart** — Recharts `ResponsiveContainer` > `BarChart` with a stacked `Bar`
  per selected project (`stackId="h"`), `XAxis` = month labels, `YAxis` = hours,
  `Tooltip` showing per-project hours + month total, colours stable per project.
- **Empty states** — "Select at least one report" / "Select at least one
  project" when either selection is empty.

### 4. Colours

Stable per-project colour from the `dataviz` skill's categorical palette,
assigned by the project's index in the sorted `projects[]` (so a project keeps
its colour regardless of which are toggled). "Unassigned" gets a distinct muted
colour (e.g. neutral grey) so it reads as "not a real project". The `dataviz`
skill is loaded before writing the chart component to pull the exact palette.

### 5. Nav

Add an "Analytics" link to the admin layout
([`web/src/app/admin/layout.tsx`](../../../web/src/app/admin/layout.tsx))
alongside the existing admin navigation.

## Data flow

```
Prisma (reports + items + assignments)
  → buildProjectTimeMatrix()            [server, pure]
  → AnalyticsMatrix (JSON-safe)         [server → client props]
  → AnalyticsDashboard                  [client: filter by selected reports/projects]
      → chart data + per-project totals [memoised]
      → Recharts stacked bar + totals panel
```

## Edge cases

- **Report with no items** → contributes an all-zero column; still selectable,
  bar height 0.
- **Item with `workedMinutes = 0`** → contributes 0 to its projects (harmless).
- **All reports unchecked** → chart area shows "Select at least one report".
- **All projects unchecked** → chart area shows "Select at least one project".
- **Project renamed** → uses current `Project.name` via the assignment relation.
- **Large project count** → palette indices wrap; legend/totals list grows.
  Acceptable for an internal tool (see non-goals).
- **Rounding** → minutes summed as floats; converted to hours only at display, so
  the stacked segments add up to the displayed month total.

## Testing

- **Unit (vitest)** for `buildProjectTimeMatrix` in `analytics.test.ts`:
  - single-project item → all minutes to that project;
  - multi-project item → even split, and splits sum back to the item's minutes;
  - unassigned item → Unassigned bucket;
  - zero-item report → empty column;
  - total preservation: per-report project sum equals report's total minutes;
  - Unassigned sorts last; real projects sorted by name.
- **Visual** — the chart and interactions are verified in the browser by the
  user (per project convention, the dev server is not auto-started here).

## Files

- `web/src/lib/analytics.ts` — new; pure attribution/matrix builder.
- `web/src/lib/analytics.test.ts` — new; vitest unit tests.
- `web/src/app/admin/analytics/page.tsx` — new; server component + Prisma query.
- `web/src/app/admin/analytics/AnalyticsDashboard.tsx` — new; `"use client"` UI.
- `web/src/app/admin/layout.tsx` — edit; add "Analytics" nav link.
- `web/package.json` — edit; add `recharts` dependency.
