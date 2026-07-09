# Invoice Excel Export — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Stock reviewer a one-click "Export to Excel" download on an approved report that reproduces their hand-built invoice workbook (Tickets + Overview sheets) using the app's existing even-split math.

**Architecture:** A pure, unit-tested engine (`invoice-export.ts`) turns a report's approved items + assignments into a plain `ExportModel` (ticket rows with per-group split hours, plus per-group hour/CZK totals). A thin exceljs renderer (`invoice-workbook.ts`) turns that model into an `.xlsx` with JIRA hyperlinks and a live EUR formula. A token-authenticated `GET` route streams the file; a link on the review page triggers it. Phase 1 uses one hardcoded `DEFAULT_PRESET` (FR/GER); Phase 2 (separate plan) makes it configurable.

**Tech Stack:** Next.js 16 App Router (route handler), Prisma, exceljs (new dependency), vitest.

## Global Constraints

- **This is NOT the Next.js you know** — per [`web/AGENTS.md`](../../../web/AGENTS.md), read the relevant guide in `web/node_modules/next/dist/docs/` before writing route/page code. `params` is a `Promise` in route handlers (see the existing backup route).
- **Keep `invoice-export.ts` pure** — no imports from Prisma, Next, or exceljs. It mirrors [`web/src/lib/report-backup.ts`](../../../web/src/lib/report-backup.ts), which is "purely unit-testable." exceljs lives only in `invoice-workbook.ts` and the route.
- **Even split only.** Split a shared item's `workedMinutes` evenly across **all** its assigned projects (`workedMinutes / assignedProjectIds.length`), identical to [`ReviewItems.tsx:133`](../../../web/src/app/review/%5Btoken%5D/ReviewItems.tsx#L133). No weighted ratios.
- **Approved items only.** Only `approval === "approved"` items contribute. Internal items are already excluded at the DB query (`where: { internal: false }`).
- **Money uses `Math.ceil`.** CZK = `Math.ceil((minutes / 60) * hourlyRateCzk)`, matching [`minutesToCzk`](../../../web/src/lib/format.ts#L17). When `hourlyRateCzk` is null, omit CZK/EUR.
- **Never log or echo the magic token** in the route's responses or errors.
- **Default preset (hardcoded for Phase 1):** groups `FR = {french_pimcore, sap_spirit_fr}`, `GER = {german_pimcore, sap_spirit_de}`; ticket columns `[month, country, ticket, description, hours, note]`; `eurRate = 24.2`; both sheets on.

---

### Task 1: Pure export engine (`computeExportModel`)

**Files:**
- Create: `web/src/lib/invoice-export.ts`
- Test: `web/src/lib/invoice-export.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - Types `TicketColumnKey`, `ColumnGroup`, `ExportPresetConfig`, `ExportItem`, `ExportReport`, `ExportInput`, `ExportTicketRow`, `ExportOverviewGroup`, `ExportOverview`, `ExportModel`.
  - `DEFAULT_PRESET: ExportPresetConfig`.
  - `computeExportModel(input: ExportInput, preset: ExportPresetConfig): ExportModel`.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/invoice-export.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  computeExportModel,
  DEFAULT_PRESET,
  type ExportInput,
  type ExportItem,
} from "./invoice-export";

function item(partial: Partial<ExportItem>): ExportItem {
  return {
    jiraKey: "PCM2-1",
    summary: "A ticket",
    workedMinutes: 60,
    estimatedSeconds: null,
    jiraStatus: null,
    parentKey: null,
    parentSummary: null,
    portaNotes: null,
    reviewerComment: null,
    approval: "approved",
    assignedProjectIds: ["french_pimcore"],
    ...partial,
  };
}

function input(items: ExportItem[], hourlyRateCzk: number | null = 1000): ExportInput {
  return {
    report: {
      label: "2026-05",
      periodStart: new Date("2026-05-01T00:00:00.000Z"),
      hourlyRateCzk,
    },
    items,
    jiraBaseUrl: "https://stockspirits.atlassian.net",
  };
}

describe("computeExportModel", () => {
  it("derives the month number from periodStart (UTC)", () => {
    const model = computeExportModel(input([]), DEFAULT_PRESET);
    expect(model.monthNumber).toBe(5);
  });

  it("splits a shared ticket evenly into one row per group", () => {
    const model = computeExportModel(
      input([
        item({
          jiraKey: "PCM2-187",
          summary: "PIMCore models",
          workedMinutes: 120,
          assignedProjectIds: ["french_pimcore", "german_pimcore"],
        }),
      ]),
      DEFAULT_PRESET,
    );
    const fr = model.ticketRows.find((r) => r.groupKey === "FR" && r.ticketLabel === "PCM2-187");
    const ger = model.ticketRows.find((r) => r.groupKey === "GER" && r.ticketLabel === "PCM2-187");
    expect(fr?.hours).toBe(1);
    expect(ger?.hours).toBe(1);
    expect(fr?.jiraUrl).toBe("https://stockspirits.atlassian.net/browse/PCM2-187");
    expect(fr?.description).toBe("PIMCore models");
  });

  it("sums shares into a single row when two assigned projects map to the same group", () => {
    const model = computeExportModel(
      input([
        item({
          jiraKey: "SAPS-9",
          workedMinutes: 120,
          assignedProjectIds: ["french_pimcore", "sap_spirit_fr"],
        }),
      ]),
      DEFAULT_PRESET,
    );
    const frRows = model.ticketRows.filter((r) => r.groupKey === "FR");
    expect(frRows).toHaveLength(1);
    expect(frRows[0].hours).toBe(2); // 60 + 60 minutes -> 2h, one row
  });

  it("renders a PM row with 'PM' label, no url, and the summary as the note", () => {
    const model = computeExportModel(
      input([
        item({
          jiraKey: null,
          summary: "Weekly status",
          workedMinutes: 69,
          assignedProjectIds: ["french_pimcore"],
        }),
      ]),
      DEFAULT_PRESET,
    );
    const row = model.ticketRows[0];
    expect(row.ticketLabel).toBe("PM");
    expect(row.jiraUrl).toBeNull();
    expect(row.description).toBe("");
    expect(row.note).toBe("Weekly status");
    expect(row.hours).toBeCloseTo(1.15);
  });

  it("prefers reviewerComment over portaNotes for a JIRA row note", () => {
    const withComment = computeExportModel(
      input([item({ reviewerComment: "rc", portaNotes: "pn" })]),
      DEFAULT_PRESET,
    );
    expect(withComment.ticketRows[0].note).toBe("rc");
    const withPortaOnly = computeExportModel(
      input([item({ reviewerComment: null, portaNotes: "pn" })]),
      DEFAULT_PRESET,
    );
    expect(withPortaOnly.ticketRows[0].note).toBe("pn");
  });

  it("excludes unapproved items and counts unassigned/ungrouped hours as excluded", () => {
    const model = computeExportModel(
      input([
        item({ jiraKey: "P-approved", workedMinutes: 60, assignedProjectIds: ["french_pimcore"] }),
        item({ jiraKey: "P-pending", approval: "pending", workedMinutes: 600, assignedProjectIds: ["french_pimcore"] }),
        item({ jiraKey: "P-unassigned", workedMinutes: 60, assignedProjectIds: [] }),
        item({ jiraKey: "P-othergroup", workedMinutes: 120, assignedProjectIds: ["czech_pimcore"] }),
      ]),
      DEFAULT_PRESET,
    );
    expect(model.ticketRows.map((r) => r.ticketLabel)).toEqual(["P-approved"]);
    expect(model.excludedHours).toBe(3); // 1h unassigned + 2h ungrouped
  });

  it("computes per-group and total hours and CZK", () => {
    const model = computeExportModel(
      input(
        [
          item({ jiraKey: "A", workedMinutes: 420, assignedProjectIds: ["sap_spirit_fr"] }),
          item({ jiraKey: "B", workedMinutes: 60, assignedProjectIds: ["german_pimcore"] }),
        ],
        1000,
      ),
      DEFAULT_PRESET,
    );
    const fr = model.overview.groups.find((g) => g.key === "FR")!;
    const ger = model.overview.groups.find((g) => g.key === "GER")!;
    expect(fr.hours).toBe(7);
    expect(fr.czk).toBe(7000);
    expect(ger.hours).toBe(1);
    expect(ger.czk).toBe(1000);
    expect(model.overview.totalHours).toBe(8);
    expect(model.overview.totalCzk).toBe(8000);
    expect(model.overview.eurRate).toBe(24.2);
  });

  it("sets CZK to null when the report has no hourly rate", () => {
    const model = computeExportModel(
      input([item({ workedMinutes: 60 })], null),
      DEFAULT_PRESET,
    );
    expect(model.overview.groups[0].czk).toBeNull();
    expect(model.overview.totalCzk).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/invoice-export.test.ts`
Expected: FAIL — `Failed to resolve import "./invoice-export"` (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `web/src/lib/invoice-export.ts`:

```ts
// Pure invoice-export engine. No imports from Prisma, Next, or exceljs so this
// module stays fast and trivially unit-testable (mirrors report-backup.ts).
// The download route maps Prisma rows into ExportInput; invoice-workbook.ts
// renders the returned ExportModel into an .xlsx.

export type TicketColumnKey =
  | "month"
  | "country"
  | "ticket"
  | "description"
  | "hours"
  | "note"
  | "status"
  | "parent"
  | "estimate";

export interface ColumnGroup {
  key: string;
  label: string;
  projectIds: string[];
}

export interface ExportPresetConfig {
  columnGroups: ColumnGroup[];
  ticketColumns: TicketColumnKey[];
  columnHeaders?: Partial<Record<TicketColumnKey, string>>;
  sheets: { tickets: boolean; overview: boolean };
  eurRate: number | null;
}

export interface ExportItem {
  jiraKey: string | null;
  summary: string;
  workedMinutes: number;
  estimatedSeconds: number | null;
  jiraStatus: string | null;
  parentKey: string | null;
  parentSummary: string | null;
  portaNotes: string | null;
  reviewerComment: string | null;
  approval: "pending" | "approved" | "rejected";
  assignedProjectIds: string[];
}

export interface ExportReport {
  label: string;
  periodStart: Date;
  hourlyRateCzk: number | null;
}

export interface ExportInput {
  report: ExportReport;
  items: ExportItem[];
  jiraBaseUrl: string | null;
}

export interface ExportTicketRow {
  groupKey: string;
  groupLabel: string;
  month: number;
  ticketLabel: string; // jiraKey, or "PM"
  jiraUrl: string | null; // hyperlink target; null for PM or when no base URL
  description: string;
  hours: number;
  note: string;
  status: string | null;
  parent: string | null;
  estimateHours: number | null;
  sortMinutes: number; // item.workedMinutes, for ordering only
}

export interface ExportOverviewGroup {
  key: string;
  label: string;
  hours: number;
  czk: number | null;
}

export interface ExportOverview {
  groups: ExportOverviewGroup[];
  totalHours: number;
  totalCzk: number | null;
  eurRate: number | null;
}

export interface ExportModel {
  monthNumber: number;
  ticketRows: ExportTicketRow[];
  overview: ExportOverview;
  excludedHours: number;
}

export const DEFAULT_PRESET: ExportPresetConfig = {
  columnGroups: [
    { key: "FR", label: "FR", projectIds: ["french_pimcore", "sap_spirit_fr"] },
    { key: "GER", label: "GER", projectIds: ["german_pimcore", "sap_spirit_de"] },
  ],
  ticketColumns: ["month", "country", "ticket", "description", "hours", "note"],
  sheets: { tickets: true, overview: true },
  eurRate: 24.2,
};

function jiraUrl(base: string | null, key: string): string | null {
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/browse/${key}`;
}

export function computeExportModel(
  input: ExportInput,
  preset: ExportPresetConfig,
): ExportModel {
  const monthNumber = input.report.periodStart.getUTCMonth() + 1;
  const rate = input.report.hourlyRateCzk;

  // projectId -> group; first group that lists the project wins.
  const groupByProject = new Map<string, ColumnGroup>();
  for (const g of preset.columnGroups) {
    for (const pid of g.projectIds) {
      if (!groupByProject.has(pid)) groupByProject.set(pid, g);
    }
  }

  const groupMinutes = new Map<string, number>();
  for (const g of preset.columnGroups) groupMinutes.set(g.key, 0);

  const ticketRows: ExportTicketRow[] = [];
  let excludedMinutes = 0;

  for (const it of input.items) {
    if (it.approval !== "approved") continue;
    const assigned = it.assignedProjectIds;
    if (assigned.length === 0) {
      excludedMinutes += it.workedMinutes;
      continue;
    }
    const share = it.workedMinutes / assigned.length;

    // Sum this item's shares per group (several assigned projects can map to
    // the same group -> a single row).
    const perGroupForItem = new Map<string, number>();
    for (const pid of assigned) {
      const g = groupByProject.get(pid);
      if (!g) {
        excludedMinutes += share;
        continue;
      }
      perGroupForItem.set(g.key, (perGroupForItem.get(g.key) ?? 0) + share);
    }

    const isPm = it.jiraKey === null;
    for (const g of preset.columnGroups) {
      const mins = perGroupForItem.get(g.key);
      if (mins == null || mins === 0) continue;
      groupMinutes.set(g.key, (groupMinutes.get(g.key) ?? 0) + mins);
      ticketRows.push({
        groupKey: g.key,
        groupLabel: g.label,
        month: monthNumber,
        ticketLabel: isPm ? "PM" : it.jiraKey!,
        jiraUrl: isPm ? null : jiraUrl(input.jiraBaseUrl, it.jiraKey!),
        description: isPm ? "" : it.summary,
        hours: mins / 60,
        note: isPm ? it.summary : (it.reviewerComment ?? it.portaNotes ?? ""),
        status: it.jiraStatus,
        parent: it.parentKey,
        estimateHours:
          it.estimatedSeconds == null ? null : it.estimatedSeconds / 3600,
        sortMinutes: it.workedMinutes,
      });
    }
  }

  // Order: configured group order, then worked time desc within a group.
  const groupOrder = new Map(preset.columnGroups.map((g, i) => [g.key, i]));
  ticketRows.sort((a, b) => {
    const ga = groupOrder.get(a.groupKey) ?? 0;
    const gb = groupOrder.get(b.groupKey) ?? 0;
    if (ga !== gb) return ga - gb;
    return b.sortMinutes - a.sortMinutes;
  });

  const groups: ExportOverviewGroup[] = preset.columnGroups.map((g) => {
    const mins = groupMinutes.get(g.key) ?? 0;
    return {
      key: g.key,
      label: g.label,
      hours: mins / 60,
      czk: rate == null ? null : Math.ceil((mins / 60) * rate),
    };
  });
  const totalHours = groups.reduce((s, g) => s + g.hours, 0);
  const totalCzk =
    rate == null ? null : groups.reduce((s, g) => s + (g.czk ?? 0), 0);

  return {
    monthNumber,
    ticketRows,
    overview: { groups, totalHours, totalCzk, eurRate: preset.eurRate },
    excludedHours: excludedMinutes / 60,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/invoice-export.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/invoice-export.ts web/src/lib/invoice-export.test.ts
git commit -m "$(cat <<'EOF'
Add pure invoice-export engine (computeExportModel)

Even-split per-group ticket rows + per-group hour/CZK totals from a
report's approved items. Prisma/Next/exceljs-free for unit testing.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Workbook renderer (`renderWorkbook`)

**Files:**
- Modify: `web/package.json` (add `exceljs`)
- Create: `web/src/lib/invoice-workbook.ts`
- Test: `web/src/lib/invoice-workbook.test.ts`

**Interfaces:**
- Consumes: `ExportModel`, `ExportPresetConfig`, `ExportTicketRow`, `TicketColumnKey` from `./invoice-export` (Task 1).
- Produces: `renderWorkbook(model: ExportModel, preset: ExportPresetConfig): ExcelJS.Workbook`.

- [ ] **Step 1: Install exceljs**

Run: `cd web && npm install exceljs`
Expected: `exceljs` added to `web/package.json` dependencies; install completes without error.

- [ ] **Step 2: Write the failing test**

Create `web/src/lib/invoice-workbook.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderWorkbook } from "./invoice-workbook";
import type { ExportModel, ExportPresetConfig } from "./invoice-export";

const preset: ExportPresetConfig = {
  columnGroups: [
    { key: "FR", label: "FR", projectIds: ["french_pimcore"] },
    { key: "GER", label: "GER", projectIds: ["german_pimcore"] },
  ],
  ticketColumns: ["month", "country", "ticket", "description", "hours", "note"],
  sheets: { tickets: true, overview: true },
  eurRate: 24.2,
};

function sampleModel(): ExportModel {
  return {
    monthNumber: 5,
    ticketRows: [
      {
        groupKey: "FR",
        groupLabel: "FR",
        month: 5,
        ticketLabel: "SAPS-1",
        jiraUrl: "https://x.atlassian.net/browse/SAPS-1",
        description: "Do a thing",
        hours: 7,
        note: "",
        status: null,
        parent: null,
        estimateHours: null,
        sortMinutes: 420,
      },
      {
        groupKey: "FR",
        groupLabel: "FR",
        month: 5,
        ticketLabel: "PM",
        jiraUrl: null,
        description: "",
        hours: 1.15,
        note: "Weekly status",
        status: null,
        parent: null,
        estimateHours: null,
        sortMinutes: 69,
      },
    ],
    overview: {
      groups: [
        { key: "FR", label: "FR", hours: 8.15, czk: 8150 },
        { key: "GER", label: "GER", hours: 0, czk: 0 },
      ],
      totalHours: 8.15,
      totalCzk: 8150,
      eurRate: 24.2,
    },
    excludedHours: 0,
  };
}

describe("renderWorkbook", () => {
  it("writes a Tickets sheet: header, a hyperlink ticket cell, a plain PM cell, numeric hours", () => {
    const ws = renderWorkbook(sampleModel(), preset).getWorksheet("Tickets")!;
    expect(ws.getRow(1).values).toContain("Ticket");
    const link = ws.getCell(2, 3).value as { text: string; hyperlink: string };
    expect(link.text).toBe("SAPS-1");
    expect(link.hyperlink).toBe("https://x.atlassian.net/browse/SAPS-1");
    expect(ws.getCell(3, 3).value).toBe("PM");
    expect(ws.getCell(2, 5).value).toBe(7);
  });

  it("writes the Overview EUR row as a live formula referencing the CZK cell", () => {
    const ws = renderWorkbook(sampleModel(), preset).getWorksheet("Overview")!;
    // Row 1 header, Row 2 hours, Row 3 CZK, Row 4 EUR.
    const eur = ws.getCell(4, 2).value as { formula: string; result?: number };
    expect(eur.formula).toBe("B3/24.2");
    expect(eur.result).toBeCloseTo(8150 / 24.2);
  });

  it("omits CZK/EUR rows when there is no rate", () => {
    const model = sampleModel();
    model.overview.groups = model.overview.groups.map((g) => ({ ...g, czk: null }));
    model.overview.totalCzk = null;
    const ws = renderWorkbook(model, preset).getWorksheet("Overview")!;
    expect(ws.getCell(3, 1).value).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/invoice-workbook.test.ts`
Expected: FAIL — `Failed to resolve import "./invoice-workbook"`.

- [ ] **Step 4: Write the implementation**

Create `web/src/lib/invoice-workbook.ts`:

```ts
import ExcelJS from "exceljs";
import type {
  ExportModel,
  ExportPresetConfig,
  ExportTicketRow,
  TicketColumnKey,
} from "./invoice-export";

const COLUMN_LABELS: Record<TicketColumnKey, string> = {
  month: "Month",
  country: "Country",
  ticket: "Ticket",
  description: "Description",
  hours: "Hours",
  note: "Note",
  status: "Status",
  parent: "Parent",
  estimate: "Estimate (h)",
};

type CellValue = string | number | { text: string; hyperlink: string };

function ticketCell(row: ExportTicketRow, key: TicketColumnKey): CellValue {
  switch (key) {
    case "month":
      return row.month;
    case "country":
      return row.groupLabel;
    case "ticket":
      return row.jiraUrl
        ? { text: row.ticketLabel, hyperlink: row.jiraUrl }
        : row.ticketLabel;
    case "description":
      return row.description;
    case "hours":
      return row.hours;
    case "note":
      return row.note;
    case "status":
      return row.status ?? "";
    case "parent":
      return row.parent ?? "";
    case "estimate":
      return row.estimateHours ?? "";
  }
}

export function renderWorkbook(
  model: ExportModel,
  preset: ExportPresetConfig,
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Proficio";

  if (preset.sheets.tickets) {
    const ws = workbook.addWorksheet("Tickets");
    ws.addRow(
      preset.ticketColumns.map(
        (k) => preset.columnHeaders?.[k] ?? COLUMN_LABELS[k],
      ),
    );
    ws.getRow(1).font = { bold: true };
    for (const row of model.ticketRows) {
      ws.addRow(preset.ticketColumns.map((k) => ticketCell(row, k)));
    }
  }

  if (preset.sheets.overview) {
    const ws = workbook.addWorksheet("Overview");
    const groups = model.overview.groups;
    const rate = model.overview.eurRate;

    // Row 1: header — blank corner, group labels, Total.
    ws.addRow(["", ...groups.map((g) => g.label), "Total"]);
    ws.getRow(1).font = { bold: true };

    // Row 2: hours per group + total.
    ws.addRow(["Hours", ...groups.map((g) => g.hours), model.overview.totalHours]);

    // Row 3: CZK (only when the report has a rate).
    const hasCzk = model.overview.totalCzk != null;
    if (hasCzk) {
      ws.addRow([
        "Invoicing CZK",
        ...groups.map((g) => g.czk ?? 0),
        model.overview.totalCzk ?? 0,
      ]);
    }

    // Row 4: EUR as a live formula referencing the CZK cell, so the client can
    // retune the rate in the file — but only when there is a CZK row and a rate.
    if (hasCzk && rate != null) {
      const czkRowNum = 3;
      const eurRowNum = ws.addRow(["App price EUR"]).number;
      const lastCol = groups.length + 2; // A + one per group + Total
      for (let col = 2; col <= lastCol; col++) {
        const czkCell = ws.getCell(czkRowNum, col);
        const result =
          typeof czkCell.value === "number" ? czkCell.value / rate : undefined;
        ws.getCell(eurRowNum, col).value = {
          formula: `${czkCell.address}/${rate}`,
          result,
        };
      }
    }

    ws.getColumn(1).width = 16;
  }

  return workbook;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/invoice-workbook.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full test suite and typecheck**

Run: `cd web && npx vitest run && npx tsc --noEmit`
Expected: all tests pass; no type errors.

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/package-lock.json web/src/lib/invoice-workbook.ts web/src/lib/invoice-workbook.test.ts
git commit -m "$(cat <<'EOF'
Render invoice ExportModel to xlsx via exceljs

Tickets sheet with JIRA hyperlink cells; Overview sheet with per-group
hours/CZK and a live EUR formula. Adds the exceljs dependency.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Download route + review-page button

**Files:**
- Create: `web/src/app/review/[token]/export/route.ts`
- Modify: `web/src/app/review/[token]/page.tsx` (the locked/approved block, ~lines 111–140)

**Interfaces:**
- Consumes: `computeExportModel`, `DEFAULT_PRESET` from `@/lib/invoice-export`; `renderWorkbook` from `@/lib/invoice-workbook`; `getJiraBaseUrl` from `@/lib/jira`; `prisma` from `@/lib/prisma`.
- Produces: `GET /review/<token>/export` streaming an `.xlsx` attachment.

- [ ] **Step 1: Read the Next.js route-handler guide**

Per `web/AGENTS.md`, skim `web/node_modules/next/dist/docs/` for the current route-handler + `Response` conventions, and re-read the working example [`web/src/app/admin/reports/[id]/backup/route.ts`](../../../web/src/app/admin/reports/%5Bid%5D/backup/route.ts). Note `params` is a `Promise` and the `Content-Disposition` pattern.

- [ ] **Step 2: Write the route**

Create `web/src/app/review/[token]/export/route.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { getJiraBaseUrl } from "@/lib/jira";
import { computeExportModel, DEFAULT_PRESET } from "@/lib/invoice-export";
import { renderWorkbook } from "@/lib/invoice-workbook";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const report = await prisma.report.findUnique({
    where: { magicToken: token },
    include: {
      items: {
        where: { internal: false },
        include: { assignments: true },
      },
    },
  });
  if (!report) return new Response("Not found", { status: 404 });

  const model = computeExportModel(
    {
      report: {
        label: report.label,
        periodStart: report.periodStart,
        hourlyRateCzk: report.hourlyRateCzk,
      },
      items: report.items.map((it) => ({
        jiraKey: it.jiraKey,
        summary: it.summary,
        workedMinutes: it.workedMinutes,
        estimatedSeconds: it.estimatedSeconds,
        jiraStatus: it.jiraStatus,
        parentKey: it.parentKey,
        parentSummary: it.parentSummary,
        portaNotes: it.portaNotes,
        reviewerComment: it.reviewerComment,
        approval: it.approval,
        assignedProjectIds: it.assignments.map((a) => a.projectId),
      })),
      jiraBaseUrl: getJiraBaseUrl(),
    },
    DEFAULT_PRESET,
  );

  const workbook = renderWorkbook(model, DEFAULT_PRESET);
  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `invoice-${report.label}.xlsx`;

  return new Response(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
```

Note: `writeBuffer()` returns an exceljs `Buffer`; wrapping it in `new Uint8Array(...)` gives a `BodyInit` the `Response` accepts without a TS complaint. If `tsc` still objects to the cast, use `buffer as unknown as ArrayBuffer`.

- [ ] **Step 3: Add the Export button to the approved report**

In `web/src/app/review/[token]/page.tsx`, inside the `locked ?` branch of the "Sign off" section (the block that currently renders "You have {status} this report…" and the reopen form), add an Export link that only shows for an **approved** report. Change:

```tsx
            <div className="space-y-3">
              <p className="text-sm">
                You have {report.status} this report on{" "}
                {report.reviewedAt?.toLocaleString() ?? "—"}.
              </p>
              <form action={reopenReview}>
```

to:

```tsx
            <div className="space-y-3">
              <p className="text-sm">
                You have {report.status} this report on{" "}
                {report.reviewedAt?.toLocaleString() ?? "—"}.
              </p>
              {report.status === "approved" && (
                <a
                  href={`/review/${token}/export`}
                  className="inline-block bg-neutral-900 text-white rounded px-4 py-2 text-sm hover:bg-neutral-800"
                >
                  Export to Excel
                </a>
              )}
              <form action={reopenReview}>
```

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 5: Manual verification (user-driven — do NOT start the dev server yourself)**

Per the project constraint, the agent must not launch the dev server to verify (it has crashed the machine before). Instead, ask the user to verify in their own running app / browser:

1. Open an **approved** report's review page.
2. Confirm an **Export to Excel** button appears in the "Sign off" section.
3. Click it; confirm `invoice-<label>.xlsx` downloads.
4. Open the file: **Tickets** sheet lists tickets with clickable JIRA links and PM rows; **Overview** sheet shows FR/GER hours, CZK, and an EUR row that recomputes when the rate cell is changed.
5. Cross-check the FR/GER hour totals against the on-screen **Invoice overview** — they should match (minus any intentionally excluded, ungrouped hours).

Report any mismatch before closing the task.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/review/[token]/export/route.ts web/src/app/review/[token]/page.tsx
git commit -m "$(cat <<'EOF'
Add reviewer Export-to-Excel download for approved reports

GET /review/[token]/export streams the invoice workbook; an Export
button appears on approved reports. Uses the hardcoded FR/GER preset.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage (Phase 1 scope):**
- Ticket list + JIRA hyperlinks → Task 1 (`jiraUrl`, ticket rows) + Task 2 (hyperlink cells) ✓
- Effort per ticket + even shared-ticket split → Task 1 (`share`, per-group rows) ✓
- Per-subproject hour + CZK totals → Task 1 (`overview`) ✓
- EUR conversion as a live formula → Task 2 (formula referencing CZK cell) ✓
- Fixed FR/GER preset → `DEFAULT_PRESET` (Task 1) ✓
- Download after approval → Task 3 (route + approved-only button) ✓
- Approved-only / internal-excluded → Task 1 filter + route `where: internal:false` ✓
- Excluded (ungrouped) hours surfaced → `model.excludedHours` (computed; surfacing in the UI is a Phase 2 refinement, noted below) ✓

**Placeholder scan:** No TBD/TODO; every code and test step contains complete content.

**Type consistency:** `computeExportModel`/`renderWorkbook` signatures, `ExportModel`/`ExportPresetConfig`/`ExportTicketRow`/`TicketColumnKey`, and `DEFAULT_PRESET` are used with identical names/shapes across Tasks 1–3.

**Known Phase-1 deviations from the spec (intentional):**
- The pure engine and the exceljs renderer are **two files** (`invoice-export.ts` + `invoice-workbook.ts`) rather than the single `invoice-export.ts` the spec named, to keep exceljs out of the unit-tested core.
- The Overview sheet is a clean faithful layout (labelled rows: Hours / Invoicing CZK / App price EUR; groups as columns + Total), not a pixel match of the sample's exact cell coordinates. Confirm this reads acceptably with the reviewer; exact layout becomes configurable in Phase 2.
- `model.excludedHours` is computed but not yet shown in the UI (no config surface in Phase 1 to exclude projects deliberately — the fixed preset covers all four FR/GER projects). Surface it alongside the Phase 2 builder.

## Phase 2 (deferred — separate plan after Phase 1 review)

Not in this plan. When Phase 1 is validated with the reviewer, write a Phase 2 plan covering: the `ExportPreset` Prisma model + migration; a `config` validation schema; token-authenticated preset CRUD server actions; the reviewer-side builder UI (project grouping, column/sheet selection, EUR rate); and switching the route from `DEFAULT_PRESET` to `?preset=<id>`. The Phase 1 `DEFAULT_PRESET` becomes the seed/example.
