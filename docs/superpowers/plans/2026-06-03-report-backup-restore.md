# Report Backup / Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let PORTA download a single report as a complete, self-contained `.json` backup and upload it again to create a new report or faithfully restore an existing one (preserving review state and the client magic link).

**Architecture:** A dependency-free `report-backup.ts` lib holds the file format types plus pure `serializeBackup` / `parseBackup` functions (unit-tested with Vitest, no DB). A GET route streams the serialized backup as a download. The existing admin upload page gains a "Restore from backup" mode whose server action upserts referenced projects, then matches by embedded report `id` (falling back to unique `label`) to either create new or replace-in-place inside a transaction.

**Tech Stack:** Next.js 16 (App Router, server actions, route handlers), Prisma 6 + Postgres, TypeScript strict, Vitest (new — pure-function tests only).

**Spec:** [docs/superpowers/specs/2026-06-03-report-backup-restore-design.md](../specs/2026-06-03-report-backup-restore-design.md)

---

## File Structure

- **Create** `web/src/lib/report-backup.ts` — file-format types, `CURRENT_SCHEMA_VERSION`, `serializeBackup`, `parseBackup`. No imports from Prisma/Next so it stays purely unit-testable.
- **Create** `web/src/lib/report-backup.test.ts` — Vitest unit tests for serialize/parse + round-trip + validation errors.
- **Create** `web/vitest.config.ts` — minimal Vitest config (node env, `src/**/*.test.ts`).
- **Create** `web/src/app/admin/reports/[id]/backup/route.ts` — GET handler streaming the backup file.
- **Modify** `web/package.json` — add `vitest` dev dependency + `"test"` script.
- **Modify** `web/src/app/admin/reports/[id]/page.tsx` — add "Download backup" link in the header action row.
- **Modify** `web/src/app/admin/upload/page.tsx` — add `restoreBackup` server action + a "Restore from backup" form section.

All paths are relative to the repo root `/Users/pari/Developer/proficio-mcp`. Run commands from `web/`.

---

## Task 1: Set up Vitest

**Files:**
- Modify: `web/package.json`
- Create: `web/vitest.config.ts`

- [ ] **Step 1: Install Vitest as a dev dependency**

Run (from `web/`):
```bash
npm install -D vitest@^3.2.0
```
Expected: `package.json` gains `"vitest": "^3.2.0"` under `devDependencies`; lockfile updates.

- [ ] **Step 2: Add the test script**

In `web/package.json`, add a `test` script to the `"scripts"` block (keep the others):
```jsonc
"scripts": {
  "dev": "next dev",
  "build": "prisma migrate deploy && next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest run",
  "db:seed": "tsx prisma/seed.ts",
  "db:backfill-totals": "tsx prisma/backfill-totals.ts",
  "postinstall": "prisma generate"
}
```

- [ ] **Step 3: Create the Vitest config**

Create `web/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 4: Verify the runner works (no tests yet)**

Run: `npm test`
Expected: Vitest runs and reports `No test files found, exiting with code 0` (or similar) — it executes without crashing.

- [ ] **Step 5: Commit**

```bash
git add web/package.json web/package-lock.json web/vitest.config.ts
git commit -m "Add Vitest for pure-function unit tests"
```

---

## Task 2: Backup types + `serializeBackup`

**Files:**
- Create: `web/src/lib/report-backup.ts`
- Test: `web/src/lib/report-backup.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/report-backup.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { serializeBackup, CURRENT_SCHEMA_VERSION, type SerializeInput } from "./report-backup";

function sampleInput(): SerializeInput {
  return {
    report: {
      id: 7,
      label: "2026-05",
      periodStart: new Date("2026-05-01T00:00:00.000Z"),
      periodEnd: new Date("2026-05-31T00:00:00.000Z"),
      productiveDealId: "3624023",
      productiveBudgetName: "stock.cz_design&development (2026/05)",
      hourlyRateCzk: 1500,
      status: "under_review",
      magicToken: "tok-abc",
      reviewerNote: "looks good",
      createdAt: new Date("2026-06-01T08:00:00.000Z"),
      sentAt: new Date("2026-06-01T09:00:00.000Z"),
      reviewedAt: null,
      items: [
        {
          source: "jira",
          jiraKey: "PCM2-123",
          summary: "Build the thing",
          workedMinutes: 120,
          totalWorkedMinutes: 480,
          estimatedSeconds: 3600,
          jiraIssuetype: "Task",
          jiraStatus: "Done",
          jiraLabels: ["frontend", "billable"],
          parentKey: "PCM2-100",
          parentSummary: "Epic",
          pmNotes: "pm note",
          portaNotes: "porta note",
          internal: false,
          suggestedProjects: ["czech_pimcore"],
          approval: "approved",
          reviewerComment: "ok",
          assignments: [{ projectId: "czech_pimcore" }, { projectId: "sap_spirit" }],
        },
      ],
    },
    projects: [
      { id: "czech_pimcore", name: "Czech Pimcore", sortOrder: 1 },
      { id: "sap_spirit", name: "SAP Spirit - general", sortOrder: 5 },
    ],
  };
}

describe("serializeBackup", () => {
  it("produces a complete envelope with ISO/date strings and resolved assignments", () => {
    const backup = serializeBackup(sampleInput(), "2026-06-03T12:00:00.000Z");

    expect(backup.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(backup.exportedAt).toBe("2026-06-03T12:00:00.000Z");
    expect(backup.report.id).toBe(7);
    expect(backup.report.periodStart).toBe("2026-05-01");
    expect(backup.report.periodEnd).toBe("2026-05-31");
    expect(backup.report.createdAt).toBe("2026-06-01T08:00:00.000Z");
    expect(backup.report.sentAt).toBe("2026-06-01T09:00:00.000Z");
    expect(backup.report.reviewedAt).toBeNull();
    expect(backup.report.magicToken).toBe("tok-abc");
    expect(backup.report.status).toBe("under_review");

    const item = backup.report.items[0];
    expect(item.portaNotes).toBe("porta note");
    expect(item.approval).toBe("approved");
    expect(item.reviewerComment).toBe("ok");
    expect(item.internal).toBe(false);
    expect(item.jiraLabels).toEqual(["frontend", "billable"]);
    expect(item.suggestedProjects).toEqual(["czech_pimcore"]);
    expect(item.assignedProjects).toEqual(["czech_pimcore", "sap_spirit"]);

    expect(backup.projects).toEqual([
      { id: "czech_pimcore", name: "Czech Pimcore", sortOrder: 1 },
      { id: "sap_spirit", name: "SAP Spirit - general", sortOrder: 5 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./report-backup` / `serializeBackup is not defined`.

- [ ] **Step 3: Write the types + `serializeBackup`**

Create `web/src/lib/report-backup.ts`:
```ts
// Self-contained report backup format. No imports from Prisma or Next so this
// module stays purely unit-testable. The download route and restore action map
// Prisma rows to/from these shapes.

export const CURRENT_SCHEMA_VERSION = 1;

export type Approval = "pending" | "approved" | "rejected";
export type ItemSource = "jira" | "project_management";
export type ReportStatus =
  | "draft"
  | "sent"
  | "under_review"
  | "approved"
  | "rejected";

// ---- serializeBackup input (matches a Prisma report loaded with
// items -> assignments, plus the referenced projects) ----

export interface SerializeProject {
  id: string;
  name: string;
  sortOrder: number;
}

export interface SerializeAssignment {
  projectId: string;
}

export interface SerializeItem {
  source: ItemSource;
  jiraKey: string | null;
  summary: string;
  workedMinutes: number;
  totalWorkedMinutes: number | null;
  estimatedSeconds: number | null;
  jiraIssuetype: string | null;
  jiraStatus: string | null;
  jiraLabels: unknown; // Prisma Json column
  parentKey: string | null;
  parentSummary: string | null;
  pmNotes: string | null;
  portaNotes: string | null;
  internal: boolean;
  suggestedProjects: unknown; // Prisma Json column
  approval: Approval;
  reviewerComment: string | null;
  assignments: SerializeAssignment[];
}

export interface SerializeReport {
  id: number;
  label: string;
  periodStart: Date;
  periodEnd: Date;
  productiveDealId: string | null;
  productiveBudgetName: string | null;
  hourlyRateCzk: number | null;
  status: ReportStatus;
  magicToken: string;
  reviewerNote: string | null;
  createdAt: Date;
  sentAt: Date | null;
  reviewedAt: Date | null;
  items: SerializeItem[];
}

export interface SerializeInput {
  report: SerializeReport;
  projects: SerializeProject[];
}

// ---- backup file shape (what gets written to disk / validated on read) ----

export interface BackupProject {
  id: string;
  name: string;
  sortOrder: number;
}

export interface BackupItem {
  source: ItemSource;
  jiraKey: string | null;
  summary: string;
  workedMinutes: number;
  totalWorkedMinutes: number | null;
  estimatedSeconds: number | null;
  jiraIssuetype: string | null;
  jiraStatus: string | null;
  jiraLabels: string[];
  parentKey: string | null;
  parentSummary: string | null;
  pmNotes: string | null;
  portaNotes: string | null;
  internal: boolean;
  suggestedProjects: string[];
  approval: Approval;
  reviewerComment: string | null;
  assignedProjects: string[];
}

export interface BackupReport {
  id: number;
  label: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  productiveDealId: string | null;
  productiveBudgetName: string | null;
  hourlyRateCzk: number | null;
  status: ReportStatus;
  magicToken: string;
  reviewerNote: string | null;
  createdAt: string; // ISO datetime
  sentAt: string | null;
  reviewedAt: string | null;
  items: BackupItem[];
}

export interface Backup {
  schemaVersion: number;
  exportedAt: string;
  report: BackupReport;
  projects: BackupProject[];
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toIso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function serializeBackup(input: SerializeInput, exportedAt: string): Backup {
  const { report, projects } = input;
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt,
    report: {
      id: report.id,
      label: report.label,
      periodStart: toDateString(report.periodStart),
      periodEnd: toDateString(report.periodEnd),
      productiveDealId: report.productiveDealId,
      productiveBudgetName: report.productiveBudgetName,
      hourlyRateCzk: report.hourlyRateCzk,
      status: report.status,
      magicToken: report.magicToken,
      reviewerNote: report.reviewerNote,
      createdAt: report.createdAt.toISOString(),
      sentAt: toIso(report.sentAt),
      reviewedAt: toIso(report.reviewedAt),
      items: report.items.map((it) => ({
        source: it.source,
        jiraKey: it.jiraKey,
        summary: it.summary,
        workedMinutes: it.workedMinutes,
        totalWorkedMinutes: it.totalWorkedMinutes,
        estimatedSeconds: it.estimatedSeconds,
        jiraIssuetype: it.jiraIssuetype,
        jiraStatus: it.jiraStatus,
        jiraLabels: asStringArray(it.jiraLabels),
        parentKey: it.parentKey,
        parentSummary: it.parentSummary,
        pmNotes: it.pmNotes,
        portaNotes: it.portaNotes,
        internal: it.internal,
        suggestedProjects: asStringArray(it.suggestedProjects),
        approval: it.approval,
        reviewerComment: it.reviewerComment,
        assignedProjects: it.assignments.map((a) => a.projectId),
      })),
    },
    projects: projects.map((p) => ({ id: p.id, name: p.name, sortOrder: p.sortOrder })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — 1 passing test.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/report-backup.ts web/src/lib/report-backup.test.ts
git commit -m "Add report backup format + serializeBackup"
```

---

## Task 3: `parseBackup` (validation + round-trip)

**Files:**
- Modify: `web/src/lib/report-backup.ts`
- Test: `web/src/lib/report-backup.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `web/src/lib/report-backup.test.ts` (add `parseBackup` to the existing top import):
```ts
import { parseBackup } from "./report-backup";

describe("parseBackup", () => {
  it("round-trips a serialized backup unchanged", () => {
    const backup = serializeBackup(sampleInput(), "2026-06-03T12:00:00.000Z");
    expect(parseBackup(backup)).toEqual(backup);
  });

  it("rejects an unsupported schemaVersion", () => {
    const backup = serializeBackup(sampleInput(), "2026-06-03T12:00:00.000Z");
    expect(() => parseBackup({ ...backup, schemaVersion: 99 })).toThrow(/schemaVersion/);
  });

  it("rejects a missing report object", () => {
    expect(() => parseBackup({ schemaVersion: 1, exportedAt: "x", projects: [] })).toThrow(
      /report/,
    );
  });

  it("rejects a bad period format", () => {
    const backup = serializeBackup(sampleInput(), "2026-06-03T12:00:00.000Z");
    const bad = { ...backup, report: { ...backup.report, periodStart: "May 2026" } };
    expect(() => parseBackup(bad)).toThrow(/periodStart must be YYYY-MM-DD/);
  });

  it("rejects an invalid item approval value", () => {
    const backup = serializeBackup(sampleInput(), "2026-06-03T12:00:00.000Z");
    const items = [{ ...backup.report.items[0], approval: "maybe" }];
    const bad = { ...backup, report: { ...backup.report, items } };
    expect(() => parseBackup(bad)).toThrow(/approval/);
  });

  it("rejects when projects is not an array", () => {
    const backup = serializeBackup(sampleInput(), "2026-06-03T12:00:00.000Z");
    expect(() => parseBackup({ ...backup, projects: "nope" })).toThrow(/projects must be an array/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `parseBackup is not a function` / not exported.

- [ ] **Step 3: Implement `parseBackup`**

Append to `web/src/lib/report-backup.ts`:
```ts
export type ParsedBackup = Backup;

const REPORT_STATUSES: ReportStatus[] = [
  "draft",
  "sent",
  "under_review",
  "approved",
  "rejected",
];

export function parseBackup(input: unknown): ParsedBackup {
  if (!input || typeof input !== "object") {
    throw new Error("Backup must be a JSON object.");
  }
  const root = input as Record<string, unknown>;

  if (root.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported schemaVersion: ${String(root.schemaVersion)} (expected ${CURRENT_SCHEMA_VERSION}).`,
    );
  }
  if (typeof root.exportedAt !== "string") {
    throw new Error("Missing field: exportedAt.");
  }

  const rRaw = root.report;
  if (!rRaw || typeof rRaw !== "object") {
    throw new Error("Backup is missing the report object.");
  }
  const rep = rRaw as Record<string, unknown>;

  const reqStr = (k: string): string => {
    const v = rep[k];
    if (typeof v !== "string" || v === "") throw new Error(`Missing field: report.${k}`);
    return v;
  };
  const optStr = (k: string): string | null => {
    const v = rep[k];
    if (v === undefined || v === null) return null;
    if (typeof v !== "string") throw new Error(`Field report.${k} must be a string or null.`);
    return v;
  };
  const optInt = (k: string): number | null => {
    const v = rep[k];
    if (v === undefined || v === null) return null;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`Field report.${k} must be a number or null.`);
    }
    return v;
  };
  const isoOrNull = (k: string): string | null => {
    const v = rep[k];
    if (v === undefined || v === null) return null;
    if (typeof v !== "string" || Number.isNaN(Date.parse(v))) {
      throw new Error(`report.${k} must be an ISO datetime or null.`);
    }
    return v;
  };

  if (typeof rep.id !== "number" || !Number.isInteger(rep.id)) {
    throw new Error("report.id must be an integer.");
  }
  const label = reqStr("label");
  const periodStart = reqStr("periodStart");
  const periodEnd = reqStr("periodEnd");
  for (const [k, v] of [
    ["periodStart", periodStart],
    ["periodEnd", periodEnd],
  ] as const) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`report.${k} must be YYYY-MM-DD.`);
  }
  const status = reqStr("status");
  if (!REPORT_STATUSES.includes(status as ReportStatus)) {
    throw new Error(`Invalid report.status: ${status}.`);
  }
  const magicToken = reqStr("magicToken");
  const createdAt = rep.createdAt;
  if (typeof createdAt !== "string" || Number.isNaN(Date.parse(createdAt))) {
    throw new Error("report.createdAt must be an ISO datetime.");
  }

  if (!Array.isArray(rep.items)) throw new Error("report.items must be an array.");
  const items: BackupItem[] = rep.items.map((raw, i) => {
    if (!raw || typeof raw !== "object") throw new Error(`Item ${i} is not an object.`);
    const it = raw as Record<string, unknown>;
    if (it.source !== "jira" && it.source !== "project_management") {
      throw new Error(`Item ${i} has invalid source: ${String(it.source)}.`);
    }
    if (typeof it.summary !== "string" || !it.summary) {
      throw new Error(`Item ${i} missing summary.`);
    }
    if (typeof it.workedMinutes !== "number" || it.workedMinutes < 0) {
      throw new Error(`Item ${i} has invalid workedMinutes.`);
    }
    if (it.approval !== "pending" && it.approval !== "approved" && it.approval !== "rejected") {
      throw new Error(`Item ${i} has invalid approval: ${String(it.approval)}.`);
    }
    if (typeof it.internal !== "boolean") {
      throw new Error(`Item ${i} internal must be a boolean.`);
    }
    if (!Array.isArray(it.jiraLabels)) throw new Error(`Item ${i} jiraLabels must be an array.`);
    if (!Array.isArray(it.suggestedProjects)) {
      throw new Error(`Item ${i} suggestedProjects must be an array.`);
    }
    if (!Array.isArray(it.assignedProjects)) {
      throw new Error(`Item ${i} assignedProjects must be an array.`);
    }
    return {
      source: it.source,
      jiraKey: typeof it.jiraKey === "string" ? it.jiraKey : null,
      summary: it.summary,
      workedMinutes: it.workedMinutes,
      totalWorkedMinutes:
        typeof it.totalWorkedMinutes === "number" ? it.totalWorkedMinutes : null,
      estimatedSeconds: typeof it.estimatedSeconds === "number" ? it.estimatedSeconds : null,
      jiraIssuetype: typeof it.jiraIssuetype === "string" ? it.jiraIssuetype : null,
      jiraStatus: typeof it.jiraStatus === "string" ? it.jiraStatus : null,
      jiraLabels: it.jiraLabels.filter((x): x is string => typeof x === "string"),
      parentKey: typeof it.parentKey === "string" ? it.parentKey : null,
      parentSummary: typeof it.parentSummary === "string" ? it.parentSummary : null,
      pmNotes: typeof it.pmNotes === "string" ? it.pmNotes : null,
      portaNotes: typeof it.portaNotes === "string" ? it.portaNotes : null,
      internal: it.internal,
      suggestedProjects: it.suggestedProjects.filter((x): x is string => typeof x === "string"),
      approval: it.approval,
      reviewerComment: typeof it.reviewerComment === "string" ? it.reviewerComment : null,
      assignedProjects: it.assignedProjects.filter((x): x is string => typeof x === "string"),
    };
  });

  if (!Array.isArray(root.projects)) throw new Error("projects must be an array.");
  const projects: BackupProject[] = root.projects.map((raw, i) => {
    if (!raw || typeof raw !== "object") throw new Error(`Project ${i} is not an object.`);
    const p = raw as Record<string, unknown>;
    if (typeof p.id !== "string" || !p.id) throw new Error(`Project ${i} missing id.`);
    if (typeof p.name !== "string" || !p.name) throw new Error(`Project ${i} missing name.`);
    return { id: p.id, name: p.name, sortOrder: typeof p.sortOrder === "number" ? p.sortOrder : 0 };
  });

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: root.exportedAt,
    report: {
      id: rep.id,
      label,
      periodStart,
      periodEnd,
      productiveDealId: optStr("productiveDealId"),
      productiveBudgetName: optStr("productiveBudgetName"),
      hourlyRateCzk: optInt("hourlyRateCzk"),
      status: status as ReportStatus,
      magicToken,
      reviewerNote: optStr("reviewerNote"),
      createdAt,
      sentAt: isoOrNull("sentAt"),
      reviewedAt: isoOrNull("reviewedAt"),
      items,
    },
    projects,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all `serializeBackup` and `parseBackup` tests green.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/report-backup.ts web/src/lib/report-backup.test.ts
git commit -m "Add parseBackup with validation + round-trip test"
```

---

## Task 4: Download backup route + button

No automated test (route touches the DB; the project uses pure-function tests only). Verify manually against local Docker Postgres at the end.

**Files:**
- Create: `web/src/app/admin/reports/[id]/backup/route.ts`
- Modify: `web/src/app/admin/reports/[id]/page.tsx`

- [ ] **Step 1: Create the download route**

Create `web/src/app/admin/reports/[id]/backup/route.ts`:
```ts
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { serializeBackup } from "@/lib/report-backup";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const reportId = Number(id);
  if (Number.isNaN(reportId)) return new Response("Not found", { status: 404 });

  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: { items: { include: { assignments: true } } },
  });
  if (!report) return new Response("Not found", { status: 404 });

  const projectIds = new Set<string>();
  for (const it of report.items) {
    for (const p of (it.suggestedProjects as string[] | null) ?? []) projectIds.add(p);
    for (const a of it.assignments) projectIds.add(a.projectId);
  }
  const projects = await prisma.project.findMany({
    where: { id: { in: [...projectIds] } },
    orderBy: { sortOrder: "asc" },
  });

  const exportedAt = new Date().toISOString();
  const backup = serializeBackup({ report, projects }, exportedAt);
  const filename = `backup-${report.label}-${exportedAt.slice(0, 10)}.json`;

  return new Response(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
```

- [ ] **Step 2: Add the "Download backup" link to the report header**

In `web/src/app/admin/reports/[id]/page.tsx`, find the page header action row (where the "Mark sent" / "Reopen" form buttons render, near the top of the returned JSX). Add this link alongside them:
```tsx
<a
  href={`/admin/reports/${reportId}/backup`}
  className="bg-white border border-neutral-300 text-neutral-800 rounded px-3 py-1.5 text-sm hover:bg-neutral-50"
>
  Download backup
</a>
```
Match the surrounding spacing/wrapper. `reportId` is already in scope (`const reportId = Number(id)`). Use a plain `<a>` (not `next/link`) so the browser performs a real file download rather than client-side navigation.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "web/src/app/admin/reports/[id]/backup/route.ts" "web/src/app/admin/reports/[id]/page.tsx"
git commit -m "Add report backup download route + button"
```

---

## Task 5: Restore-from-backup upload mode

No automated test (DB writes; pure-function tests only). Verify manually at the end.

**Files:**
- Modify: `web/src/app/admin/upload/page.tsx`

- [ ] **Step 1: Add imports + helper + server action**

In `web/src/app/admin/upload/page.tsx`, add to the existing imports:
```ts
import { parseBackup, type ParsedBackup } from "@/lib/report-backup";
```
The file already imports `requireAdmin` and `newMagicToken` from `@/lib/auth` — both are used by the new action, so no auth import change is needed.

Add this module-level helper (not a server action — a plain function) above the component:
```ts
function buildCreateData(backup: ParsedBackup, id: number | undefined, magicToken: string) {
  const r = backup.report;
  return {
    ...(id !== undefined ? { id } : {}),
    label: r.label,
    periodStart: new Date(r.periodStart),
    periodEnd: new Date(r.periodEnd),
    productiveDealId: r.productiveDealId,
    productiveBudgetName: r.productiveBudgetName,
    hourlyRateCzk: r.hourlyRateCzk,
    status: r.status,
    magicToken,
    reviewerNote: r.reviewerNote,
    createdAt: new Date(r.createdAt),
    sentAt: r.sentAt ? new Date(r.sentAt) : null,
    reviewedAt: r.reviewedAt ? new Date(r.reviewedAt) : null,
    items: {
      create: r.items.map((it) => ({
        source: it.source,
        jiraKey: it.jiraKey,
        summary: it.summary,
        workedMinutes: it.workedMinutes,
        totalWorkedMinutes: it.totalWorkedMinutes,
        estimatedSeconds: it.estimatedSeconds,
        jiraIssuetype: it.jiraIssuetype,
        jiraStatus: it.jiraStatus,
        jiraLabels: it.jiraLabels,
        parentKey: it.parentKey,
        parentSummary: it.parentSummary,
        pmNotes: it.pmNotes,
        portaNotes: it.portaNotes,
        internal: it.internal,
        suggestedProjects: it.suggestedProjects,
        approval: it.approval,
        reviewerComment: it.reviewerComment,
        assignments: { create: it.assignedProjects.map((projectId) => ({ projectId })) },
      })),
    },
  };
}
```

Add the server action (next to the existing `uploadReport` action):
```ts
async function restoreBackup(formData: FormData) {
  "use server";
  await requireAdmin();

  const file = formData.get("file");
  const pasted = String(formData.get("json") ?? "").trim();
  const confirmed = formData.get("confirmOverwrite") === "on";

  let text: string;
  if (file instanceof File && file.size > 0) {
    text = await file.text();
  } else if (pasted) {
    text = pasted;
  } else {
    throw new Error("Provide a backup JSON file or paste JSON in the textarea.");
  }

  const backup = parseBackup(JSON.parse(text));

  // 1. Ensure every referenced project exists (create missing, leave existing).
  for (const p of backup.projects) {
    await prisma.project.upsert({
      where: { id: p.id },
      update: {},
      create: { id: p.id, name: p.name, sortOrder: p.sortOrder },
    });
  }

  // 2. Match by embedded id, falling back to unique label.
  const byId = await prisma.report.findUnique({ where: { id: backup.report.id } });
  const target =
    byId ?? (await prisma.report.findUnique({ where: { label: backup.report.label } }));

  let resultId: number;

  if (target) {
    if (
      (target.status === "under_review" || target.status === "approved") &&
      !confirmed
    ) {
      throw new Error(
        `Report ${target.label} is ${target.status}. Tick the confirmation box to overwrite its live client-facing state.`,
      );
    }
    // Guard against unique-constraint conflicts from *other* reports before we
    // delete-and-recreate with the backup's label + token.
    const labelConflict = await prisma.report.findFirst({
      where: { label: backup.report.label, id: { not: target.id } },
    });
    if (labelConflict) {
      throw new Error(`A different report already uses label ${backup.report.label}.`);
    }
    const tokenConflict = await prisma.report.findFirst({
      where: { magicToken: backup.report.magicToken, id: { not: target.id } },
    });
    if (tokenConflict) {
      throw new Error(`A different report already uses this magic link token.`);
    }

    await prisma.$transaction(async (tx) => {
      await tx.report.delete({ where: { id: target.id } });
      await tx.report.create({
        data: buildCreateData(backup, target.id, backup.report.magicToken),
      });
    });
    resultId = target.id;
  } else {
    // Create new. Label is free (no id/label match). Preserve the token unless
    // another report already holds it, in which case mint a fresh one.
    const tokenOwner = await prisma.report.findUnique({
      where: { magicToken: backup.report.magicToken },
    });
    const token = tokenOwner ? newMagicToken() : backup.report.magicToken;
    const created = await prisma.report.create({
      data: buildCreateData(backup, undefined, token),
    });
    resultId = created.id;
  }

  redirect(`/admin/reports/${resultId}`);
}
```

Note: setting an explicit `id` on create works because Prisma maps `autoincrement()` to a Postgres sequence default — explicit inserts are permitted. We only reuse `target.id` (just deleted in the same transaction), so the sequence never collides.

- [ ] **Step 2: Add the "Restore from backup" form to the page**

In the returned JSX of `UploadPage`, below the existing upload form, add a second section:
```tsx
<div className="border-t border-neutral-200 pt-6">
  <h2 className="text-lg font-semibold">Restore from backup</h2>
  <p className="text-sm text-neutral-600 mt-1">
    Upload a backup file downloaded from a report. If a matching report exists
    (same id or month), it is restored in place — approvals, notes, and the
    client magic link are preserved. Otherwise a new report is created.
  </p>

  <form
    action={restoreBackup}
    className="space-y-4 bg-white border border-neutral-200 rounded-lg p-6 mt-4"
  >
    <label className="block">
      <span className="text-sm font-medium">Backup JSON file</span>
      <input
        type="file"
        name="file"
        accept="application/json,.json"
        className="mt-1 block text-sm"
      />
    </label>

    <div className="text-xs text-neutral-500">or paste below</div>

    <label className="block">
      <span className="text-sm font-medium">Backup JSON</span>
      <textarea
        name="json"
        rows={10}
        className="mt-1 w-full font-mono text-xs border border-neutral-300 rounded p-3"
        placeholder='{"schemaVersion": 1, "report": { ... }}'
      />
    </label>

    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name="confirmOverwrite" className="mt-0.5" />
      <span>
        I understand that restoring over a report currently in review or approved
        overwrites its live client-facing approvals and comments.
      </span>
    </label>

    <PendingButton
      className="bg-neutral-900 text-white rounded px-4 py-2 text-sm hover:bg-neutral-800"
      pendingLabel="Restoring…"
    >
      Restore report
    </PendingButton>
  </form>
</div>
```

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "web/src/app/admin/upload/page.tsx"
git commit -m "Add restore-from-backup upload mode"
```

---

## Task 6: Manual end-to-end verification

The pure-function tests cover serialize/parse. This task verifies the DB-touching paths manually against local Docker Postgres. **Do not auto-start the dev server — ask the user to run these and report results** (per project memory: verifying running apps has crashed the machine).

- [ ] **Step 1: Bring up local stack (user-run)**

From repo root: `docker compose up -d`. From `web/`: `npx prisma migrate deploy && npm run db:seed && npm run dev`.

- [ ] **Step 2: Verify download**

Open an existing report in `/admin`, click **Download backup**. Confirm a `backup-<label>-<date>.json` downloads and contains `schemaVersion`, full `report` (with `magicToken`, `status`, item `approval`/`portaNotes`/`reviewerComment`, `assignedProjects`) and a `projects` array.

- [ ] **Step 3: Verify restore-in-place**

Edit the report (add a PORTA note / change an approval), then restore the downloaded backup via **Restore from backup**. Confirm the report returns to the backed-up state, the URL/report id is unchanged, and the client magic link still works.

- [ ] **Step 4: Verify create-new**

Delete the report (or use a backup whose id/label is unused), restore the backup, and confirm a new report is created with the items, assignments, and review state intact.

- [ ] **Step 5: Verify the confirmation guard**

Set a report to `under_review`/`approved`, attempt a restore without ticking the checkbox → expect the error message. Tick it → restore succeeds.

- [ ] **Step 6: Update docs**

Add a short "Backup & restore" subsection to [docs/admin-guide.md](../../admin-guide.md) describing the Download backup button and the Restore from backup form (including the confirmation requirement). Commit:
```bash
git add docs/admin-guide.md
git commit -m "Document report backup/restore in admin guide"
```

---

## Self-Review notes

- **Spec coverage:** file format (Task 2/3), download (Task 4), restore create/update + project upsert + token/label rules + confirmation guard (Task 5), tests (Task 2/3 pure; Task 6 manual for DB paths per the chosen test approach), docs (Task 6). All spec sections map to a task.
- **Type consistency:** `serializeBackup(input, exportedAt)`, `parseBackup(input)`, `Backup`/`ParsedBackup`, `buildCreateData(backup, id, magicToken)` names are used identically across tasks.
- **Note for executor:** Task 5 Step 1 contains a deliberate self-correction on the import path — use `@/lib/report-backup`.
