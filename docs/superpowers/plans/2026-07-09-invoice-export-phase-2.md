# Invoice Excel Export — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Prerequisite:** Phase 1 ([`2026-07-09-invoice-export-phase-1.md`](2026-07-09-invoice-export-phase-1.md)) is merged — `invoice-export.ts` (`computeExportModel`, `DEFAULT_PRESET`, the `Export*` types), `invoice-workbook.ts` (`renderWorkbook`), and the download route at `web/src/app/review/[token]/export/route.ts` all exist.

**Goal:** Let the Stock reviewer self-serve — create, edit, and reuse named export presets (project subset + roll-up into output columns, configurable ticket columns/order/headers, sheet toggles, EUR rate) with a live preview, then pick a preset when exporting.

**Architecture:** A new `ExportPreset` table stores a validated `config` JSON (the Phase 1 `ExportPresetConfig` shape). A hand-rolled `parseExportPresetConfig` validator (matching [`report-schema.ts`](../../../web/src/lib/report-schema.ts)'s style — the repo has no zod) guards every read and write. Token-authenticated server actions do CRUD (mirroring [`review/[token]/actions.ts`](../../../web/src/app/review/%5Btoken%5D/actions.ts)). A reviewer-side builder page renders a client component that edits the config and shows a **live preview** by running the pure `computeExportModel` in the browser. The download route gains `?preset=<id>`, falling back to `DEFAULT_PRESET`.

**Tech Stack:** Next.js 16 App Router (server component page, client component, server actions, route handler), Prisma, vitest.

## Global Constraints

- **This is NOT the Next.js you know** — per [`web/AGENTS.md`](../../../web/AGENTS.md), read `web/node_modules/next/dist/docs/` before writing page/route/action code.
- **No zod.** Validation is hand-rolled in the style of `parseUploadReport` in [`report-schema.ts`](../../../web/src/lib/report-schema.ts) (throw `Error` with a field-named message).
- **Keep `invoice-export.ts` pure** — the `toExportInput` helper added here uses structural types only; no Prisma/Next imports. `computeExportModel` must remain importable from a client component (it is pure, no server deps).
- **Presets are global** (report-independent) for now — no `clientId`. Any valid reviewer token may read/write any preset (one client today).
- **Reviewer auth = a valid report magic token.** Every server action resolves the token via `prisma.report.findUnique({ where: { magicToken } })` and `notFound()`s on miss. Never log or echo the token.
- **Validate on both ends.** `parseExportPresetConfig` runs on every preset save (reject bad input) and on every preset load in the route (return 422, never crash the download).
- **Migrations are hand-written SQL** under `web/prisma/migrations/<name>/migration.sql`, applied by `prisma migrate deploy` at build/deploy (see existing folders like `20260518_add_client_table`).

---

### Task 1: Config validation (`parseExportPresetConfig`)

**Files:**
- Create: `web/src/lib/invoice-export-config.ts`
- Test: `web/src/lib/invoice-export-config.test.ts`

**Interfaces:**
- Consumes: `ExportPresetConfig`, `TicketColumnKey`, `ColumnGroup` types from `./invoice-export` (Phase 1).
- Produces: `parseExportPresetConfig(input: unknown): ExportPresetConfig`.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/invoice-export-config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseExportPresetConfig } from "./invoice-export-config";

function valid() {
  return {
    columnGroups: [
      { key: "FR", label: "FR", projectIds: ["french_pimcore", "sap_spirit_fr"] },
      { key: "GER", label: "GER", projectIds: ["german_pimcore"] },
    ],
    ticketColumns: ["month", "country", "ticket", "hours"],
    sheets: { tickets: true, overview: true },
    eurRate: 24.2,
  };
}

describe("parseExportPresetConfig", () => {
  it("accepts a valid config", () => {
    const cfg = parseExportPresetConfig(valid());
    expect(cfg.columnGroups).toHaveLength(2);
    expect(cfg.ticketColumns).toEqual(["month", "country", "ticket", "hours"]);
    expect(cfg.eurRate).toBe(24.2);
    expect(cfg.sheets).toEqual({ tickets: true, overview: true });
  });

  it("accepts null eurRate", () => {
    expect(parseExportPresetConfig({ ...valid(), eurRate: null }).eurRate).toBeNull();
  });

  it("rejects an empty columnGroups", () => {
    expect(() => parseExportPresetConfig({ ...valid(), columnGroups: [] })).toThrow(/columnGroups/);
  });

  it("rejects a duplicate group key", () => {
    const bad = valid();
    bad.columnGroups[1].key = "FR";
    expect(() => parseExportPresetConfig(bad)).toThrow(/Duplicate/);
  });

  it("rejects a project used in two groups", () => {
    const bad = valid();
    bad.columnGroups[1].projectIds = ["french_pimcore"];
    expect(() => parseExportPresetConfig(bad)).toThrow(/more than one group/);
  });

  it("rejects an unknown ticket column key", () => {
    expect(() => parseExportPresetConfig({ ...valid(), ticketColumns: ["month", "bogus"] })).toThrow(
      /valid column key/,
    );
  });

  it("rejects when no sheet is enabled", () => {
    expect(() =>
      parseExportPresetConfig({ ...valid(), sheets: { tickets: false, overview: false } }),
    ).toThrow(/At least one sheet/);
  });

  it("rejects a non-positive eurRate", () => {
    expect(() => parseExportPresetConfig({ ...valid(), eurRate: 0 })).toThrow(/eurRate/);
  });

  it("rejects a non-object input", () => {
    expect(() => parseExportPresetConfig(null)).toThrow(/must be an object/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/invoice-export-config.test.ts`
Expected: FAIL — `Failed to resolve import "./invoice-export-config"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/lib/invoice-export-config.ts`:

```ts
// Hand-rolled validation for an ExportPreset's stored `config` JSON, in the
// style of report-schema.ts (the repo has no zod). Used on every preset save
// and on every preset load in the download route.

import type {
  ColumnGroup,
  ExportPresetConfig,
  TicketColumnKey,
} from "./invoice-export";

const TICKET_COLUMN_KEYS: TicketColumnKey[] = [
  "month",
  "country",
  "ticket",
  "description",
  "hours",
  "note",
  "status",
  "parent",
  "estimate",
];

export function parseExportPresetConfig(input: unknown): ExportPresetConfig {
  if (!input || typeof input !== "object") {
    throw new Error("Preset config must be an object.");
  }
  const r = input as Record<string, unknown>;

  // ---- columnGroups ----
  if (!Array.isArray(r.columnGroups) || r.columnGroups.length === 0) {
    throw new Error("columnGroups must be a non-empty array.");
  }
  const seenKeys = new Set<string>();
  const columnGroups: ColumnGroup[] = r.columnGroups.map((g, i) => {
    if (!g || typeof g !== "object") {
      throw new Error(`columnGroups[${i}] must be an object.`);
    }
    const gg = g as Record<string, unknown>;
    if (typeof gg.key !== "string" || gg.key === "") {
      throw new Error(`columnGroups[${i}].key must be a non-empty string.`);
    }
    if (seenKeys.has(gg.key)) {
      throw new Error(`Duplicate columnGroups key: ${gg.key}`);
    }
    seenKeys.add(gg.key);
    if (typeof gg.label !== "string" || gg.label === "") {
      throw new Error(`columnGroups[${i}].label must be a non-empty string.`);
    }
    if (
      !Array.isArray(gg.projectIds) ||
      gg.projectIds.some((p) => typeof p !== "string")
    ) {
      throw new Error(`columnGroups[${i}].projectIds must be an array of strings.`);
    }
    return { key: gg.key, label: gg.label, projectIds: gg.projectIds as string[] };
  });

  // A project may appear in at most one group (rollup, not overlap).
  const seenProjects = new Set<string>();
  for (const g of columnGroups) {
    for (const pid of g.projectIds) {
      if (seenProjects.has(pid)) {
        throw new Error(`Project ${pid} is in more than one group.`);
      }
      seenProjects.add(pid);
    }
  }

  // ---- ticketColumns ----
  if (!Array.isArray(r.ticketColumns) || r.ticketColumns.length === 0) {
    throw new Error("ticketColumns must be a non-empty array.");
  }
  const ticketColumns = r.ticketColumns.map((c, i) => {
    if (typeof c !== "string" || !TICKET_COLUMN_KEYS.includes(c as TicketColumnKey)) {
      throw new Error(`ticketColumns[${i}] is not a valid column key: ${String(c)}`);
    }
    return c as TicketColumnKey;
  });

  // ---- columnHeaders (optional) ----
  let columnHeaders: Partial<Record<TicketColumnKey, string>> | undefined;
  if (r.columnHeaders !== undefined && r.columnHeaders !== null) {
    if (typeof r.columnHeaders !== "object") {
      throw new Error("columnHeaders must be an object.");
    }
    columnHeaders = {};
    for (const [k, v] of Object.entries(r.columnHeaders as Record<string, unknown>)) {
      if (!TICKET_COLUMN_KEYS.includes(k as TicketColumnKey)) {
        throw new Error(`columnHeaders has invalid key: ${k}`);
      }
      if (typeof v !== "string") {
        throw new Error(`columnHeaders.${k} must be a string.`);
      }
      columnHeaders[k as TicketColumnKey] = v;
    }
  }

  // ---- sheets ----
  if (!r.sheets || typeof r.sheets !== "object") {
    throw new Error("sheets must be an object.");
  }
  const s = r.sheets as Record<string, unknown>;
  if (typeof s.tickets !== "boolean" || typeof s.overview !== "boolean") {
    throw new Error("sheets.tickets and sheets.overview must be booleans.");
  }
  if (!s.tickets && !s.overview) {
    throw new Error("At least one sheet must be enabled.");
  }

  // ---- eurRate ----
  let eurRate: number | null;
  if (r.eurRate === null || r.eurRate === undefined) {
    eurRate = null;
  } else if (typeof r.eurRate === "number" && Number.isFinite(r.eurRate) && r.eurRate > 0) {
    eurRate = r.eurRate;
  } else {
    throw new Error("eurRate must be a positive number or null.");
  }

  return {
    columnGroups,
    ticketColumns,
    ...(columnHeaders ? { columnHeaders } : {}),
    sheets: { tickets: s.tickets, overview: s.overview },
    eurRate,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/invoice-export-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/invoice-export-config.ts web/src/lib/invoice-export-config.test.ts
git commit -m "$(cat <<'EOF'
Add hand-rolled validation for export preset config

parseExportPresetConfig guards preset saves and route loads: non-empty
groups with unique keys, no project in two groups, known column keys,
at least one sheet, positive-or-null eurRate.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `ExportPreset` model + migration

**Files:**
- Modify: `web/prisma/schema.prisma`
- Create: `web/prisma/migrations/20260709_add_export_preset/migration.sql`

**Interfaces:**
- Produces: the `ExportPreset` Prisma model (`prisma.exportPreset` client accessor) with fields `id`, `name`, `config` (Json), `createdAt`, `updatedAt`.

- [ ] **Step 1: Add the model to the schema**

In `web/prisma/schema.prisma`, after the `Client` model, add:

```prisma
model ExportPreset {
  id        String   @id @default(cuid())
  name      String
  config    Json
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 2: Hand-write the migration**

Create `web/prisma/migrations/20260709_add_export_preset/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "ExportPreset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExportPreset_pkey" PRIMARY KEY ("id")
);
```

- [ ] **Step 3: Regenerate the Prisma client**

Run: `cd web && npx prisma generate`
Expected: "Generated Prisma Client" — `prisma.exportPreset` is now typed.

- [ ] **Step 4: Verify the schema is valid and types compile**

Run: `cd web && npx prisma validate && npx tsc --noEmit`
Expected: "The schema at prisma/schema.prisma is valid"; no type errors.

Note: the migration is applied to the database by `prisma migrate deploy` (runs in the Vercel `build` script) on the next deploy. To exercise the feature against a local database first, the developer runs `npx prisma migrate deploy` against their `DATABASE_URL` — a quick, non-interactive command (do not start a dev server to test this).

- [ ] **Step 5: Commit**

```bash
git add web/prisma/schema.prisma web/prisma/migrations/20260709_add_export_preset/migration.sql
git commit -m "$(cat <<'EOF'
Add ExportPreset table for saved invoice export configs

Global, report-independent presets storing a validated config JSON.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Preset builder — `toExportInput` helper, CRUD actions, page, and client builder

**Files:**
- Modify: `web/src/lib/invoice-export.ts` (add `toExportInput` + `RawReport`/`RawItem` structural types)
- Test: `web/src/lib/invoice-export.test.ts` (append a `toExportInput` test)
- Create: `web/src/app/review/[token]/export-presets/actions.ts`
- Create: `web/src/app/review/[token]/export-presets/page.tsx`
- Create: `web/src/app/review/[token]/export-presets/ExportPresetBuilder.tsx`

**Interfaces:**
- Consumes: `computeExportModel`, `ExportInput`, `ExportPresetConfig`, `ColumnGroup`, `TicketColumnKey` (Phase 1); `parseExportPresetConfig` (Task 1); `prisma`, `getJiraBaseUrl`.
- Produces:
  - `toExportInput(report: RawReport, jiraBaseUrl: string | null): ExportInput`.
  - Server actions `createPreset`, `updatePreset`, `deletePreset` (each `(formData: FormData) => Promise<void>`).
  - The `ExportPresetBuilder` client component and the `/review/[token]/export-presets` page.

- [ ] **Step 1: Write the failing `toExportInput` test**

Append to `web/src/lib/invoice-export.test.ts`:

```ts
import { toExportInput } from "./invoice-export";

describe("toExportInput", () => {
  it("maps a loaded report row into ExportInput with flattened assignedProjectIds", () => {
    const input = toExportInput(
      {
        label: "2026-05",
        periodStart: new Date("2026-05-01T00:00:00.000Z"),
        hourlyRateCzk: 1500,
        items: [
          {
            jiraKey: "PCM2-1",
            summary: "s",
            workedMinutes: 60,
            estimatedSeconds: null,
            jiraStatus: "Done",
            parentKey: null,
            parentSummary: null,
            portaNotes: null,
            reviewerComment: null,
            approval: "approved",
            assignments: [{ projectId: "french_pimcore" }, { projectId: "sap_spirit_fr" }],
          },
        ],
      },
      "https://x.atlassian.net",
    );
    expect(input.report.hourlyRateCzk).toBe(1500);
    expect(input.jiraBaseUrl).toBe("https://x.atlassian.net");
    expect(input.items[0].assignedProjectIds).toEqual(["french_pimcore", "sap_spirit_fr"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/invoice-export.test.ts`
Expected: FAIL — `toExportInput is not a function` / not exported.

- [ ] **Step 3: Add `toExportInput` to the engine**

Append to `web/src/lib/invoice-export.ts` (structural types — keeps the module Prisma-free while accepting a Prisma row):

```ts
// ---- Prisma-row -> ExportInput adapter. Structural types so this stays
// framework-free; a Prisma report loaded with items+assignments satisfies them.

export interface RawItem {
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
  assignments: { projectId: string }[];
}

export interface RawReport {
  label: string;
  periodStart: Date;
  hourlyRateCzk: number | null;
  items: RawItem[];
}

export function toExportInput(
  report: RawReport,
  jiraBaseUrl: string | null,
): ExportInput {
  return {
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
    jiraBaseUrl,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/invoice-export.test.ts`
Expected: PASS (all existing + the new `toExportInput` test).

- [ ] **Step 5: Write the CRUD server actions**

Create `web/src/app/review/[token]/export-presets/actions.ts`:

```ts
"use server";

import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { parseExportPresetConfig } from "@/lib/invoice-export-config";

// Authenticate the reviewer by resolving their report token. Presets are
// global today; the token proves the caller is a legitimate reviewer.
async function requireReviewer(token: string) {
  const report = await prisma.report.findUnique({ where: { magicToken: token } });
  if (!report) notFound();
  return report;
}

function readConfig(formData: FormData) {
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("config") ?? "null"));
  } catch {
    throw new Error("Preset config is not valid JSON.");
  }
  return parseExportPresetConfig(raw);
}

export async function createPreset(formData: FormData) {
  const token = String(formData.get("token"));
  await requireReviewer(token);
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Preset name is required.");
  const config = readConfig(formData);
  await prisma.exportPreset.create({ data: { name, config } });
  revalidatePath(`/review/${token}/export-presets`);
}

export async function updatePreset(formData: FormData) {
  const token = String(formData.get("token"));
  await requireReviewer(token);
  const id = String(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Preset name is required.");
  const config = readConfig(formData);
  await prisma.exportPreset.update({ where: { id }, data: { name, config } });
  revalidatePath(`/review/${token}/export-presets`);
}

export async function deletePreset(formData: FormData) {
  const token = String(formData.get("token"));
  await requireReviewer(token);
  const id = String(formData.get("id"));
  await prisma.exportPreset.delete({ where: { id } });
  revalidatePath(`/review/${token}/export-presets`);
}
```

- [ ] **Step 6: Write the builder page (server component)**

Create `web/src/app/review/[token]/export-presets/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getJiraBaseUrl } from "@/lib/jira";
import { toExportInput, type ExportPresetConfig } from "@/lib/invoice-export";
import { ExportPresetBuilder } from "./ExportPresetBuilder";

export default async function ExportPresetsPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const report = await prisma.report.findUnique({
    where: { magicToken: token },
    include: {
      items: { where: { internal: false }, include: { assignments: true } },
    },
  });
  if (!report) notFound();

  const [projects, presetRows] = await Promise.all([
    prisma.project.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.exportPreset.findMany({ orderBy: { name: "asc" } }),
  ]);

  const input = toExportInput(report, getJiraBaseUrl());
  const presets = presetRows.map((p) => ({
    id: p.id,
    name: p.name,
    config: p.config as unknown as ExportPresetConfig,
  }));

  return (
    <div className="min-h-screen bg-neutral-50">
      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <div>
          <a href={`/review/${token}`} className="text-sm text-neutral-500 hover:underline">
            ← Back to review
          </a>
          <h1 className="text-xl font-semibold mt-1">Export presets — {report.label}</h1>
          <p className="text-sm text-neutral-600">
            Configure a reusable Excel export. The preview uses this report&apos;s
            approved items. Download from the review page once saved.
          </p>
        </div>
        <ExportPresetBuilder
          token={token}
          input={input}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          presets={presets}
        />
      </main>
    </div>
  );
}
```

- [ ] **Step 7: Write the client builder component**

Create `web/src/app/review/[token]/export-presets/ExportPresetBuilder.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import {
  computeExportModel,
  type ExportInput,
  type ExportPresetConfig,
  type TicketColumnKey,
} from "@/lib/invoice-export";
import { createPreset, updatePreset, deletePreset } from "./actions";

const ALL_COLUMNS: TicketColumnKey[] = [
  "month",
  "country",
  "ticket",
  "description",
  "hours",
  "note",
  "status",
  "parent",
  "estimate",
];
const COLUMN_LABEL: Record<TicketColumnKey, string> = {
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
const DEFAULT_COLUMNS: TicketColumnKey[] = [
  "month",
  "country",
  "ticket",
  "description",
  "hours",
  "note",
];

type ProjectLite = { id: string; name: string };
type PresetLite = { id: string; name: string; config: ExportPresetConfig };
type UiGroup = { label: string; projectIds: string[] };

function move<T>(arr: T[], i: number, dir: number): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const copy = [...arr];
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}

export function ExportPresetBuilder({
  token,
  input,
  projects,
  presets,
}: {
  token: string;
  input: ExportInput;
  projects: ProjectLite[];
  presets: PresetLite[];
}) {
  const [selectedId, setSelectedId] = useState("new");
  const [name, setName] = useState("");
  const [groups, setGroups] = useState<UiGroup[]>([]);
  const [columns, setColumns] = useState<TicketColumnKey[]>(DEFAULT_COLUMNS);
  const [headers, setHeaders] = useState<Partial<Record<TicketColumnKey, string>>>({});
  const [tickets, setTickets] = useState(true);
  const [overview, setOverview] = useState(true);
  const [eurRate, setEurRate] = useState("24.2");

  function loadPreset(id: string) {
    setSelectedId(id);
    if (id === "new") {
      setName("");
      setGroups([]);
      setColumns(DEFAULT_COLUMNS);
      setHeaders({});
      setTickets(true);
      setOverview(true);
      setEurRate("24.2");
      return;
    }
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    setName(p.name);
    setGroups(p.config.columnGroups.map((g) => ({ label: g.label, projectIds: g.projectIds })));
    setColumns(p.config.ticketColumns);
    setHeaders(p.config.columnHeaders ?? {});
    setTickets(p.config.sheets.tickets);
    setOverview(p.config.sheets.overview);
    setEurRate(p.config.eurRate == null ? "" : String(p.config.eurRate));
  }

  // project id -> index of the group already using it (disable it elsewhere)
  const projectOwner = new Map<string, number>();
  groups.forEach((g, i) => g.projectIds.forEach((pid) => projectOwner.set(pid, i)));

  function toggleProject(groupIdx: number, pid: string) {
    setGroups((prev) =>
      prev.map((g, i) => {
        if (i !== groupIdx) return g;
        const has = g.projectIds.includes(pid);
        return {
          ...g,
          projectIds: has ? g.projectIds.filter((p) => p !== pid) : [...g.projectIds, pid],
        };
      }),
    );
  }

  const config: ExportPresetConfig = useMemo(() => {
    const cleanHeaders: Partial<Record<TicketColumnKey, string>> = {};
    for (const k of columns) {
      const h = headers[k]?.trim();
      if (h) cleanHeaders[k] = h;
    }
    return {
      columnGroups: groups
        .filter((g) => g.label.trim() !== "")
        .map((g) => ({ key: g.label.trim(), label: g.label.trim(), projectIds: g.projectIds })),
      ticketColumns: columns,
      ...(Object.keys(cleanHeaders).length ? { columnHeaders: cleanHeaders } : {}),
      sheets: { tickets, overview },
      eurRate: eurRate.trim() === "" ? null : Number(eurRate),
    };
  }, [groups, columns, headers, tickets, overview, eurRate]);

  // Live preview against THIS report — computeExportModel is pure, runs here.
  const preview = useMemo(() => {
    try {
      return computeExportModel(input, config);
    } catch {
      return null;
    }
  }, [input, config]);

  const canSave =
    name.trim() !== "" &&
    config.columnGroups.length > 0 &&
    columns.length > 0 &&
    (tickets || overview) &&
    (eurRate.trim() === "" || (Number.isFinite(Number(eurRate)) && Number(eurRate) > 0));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <label className="text-sm text-neutral-600">Preset</label>
        <select
          value={selectedId}
          onChange={(e) => loadPreset(e.target.value)}
          className="border border-neutral-300 rounded px-2 py-1 text-sm"
        >
          <option value="new">➕ New preset…</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {selectedId !== "new" && (
          <form action={deletePreset} className="ml-auto">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="id" value={selectedId} />
            <button className="text-sm text-red-600 hover:underline">Delete</button>
          </form>
        )}
      </div>

      <form
        action={selectedId === "new" ? createPreset : updatePreset}
        className="space-y-6"
      >
        <input type="hidden" name="token" value={token} />
        {selectedId !== "new" && <input type="hidden" name="id" value={selectedId} />}
        <input type="hidden" name="config" value={JSON.stringify(config)} />

        <div>
          <label className="block text-sm font-medium mb-1">Preset name</label>
          <input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-neutral-300 rounded px-2 py-1 text-sm"
            placeholder="SAP re-invoicing FR+GER"
          />
        </div>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">Output columns (project groups)</h3>
            <button
              type="button"
              onClick={() => setGroups((g) => [...g, { label: "", projectIds: [] }])}
              className="text-sm text-neutral-700 border border-neutral-300 rounded px-2 py-0.5 hover:bg-neutral-50"
            >
              + Add group
            </button>
          </div>
          {groups.length === 0 && (
            <p className="text-sm text-neutral-500 italic">Add at least one group (e.g. “FR”).</p>
          )}
          {groups.map((g, i) => (
            <div key={i} className="border border-neutral-200 rounded p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  value={g.label}
                  onChange={(e) =>
                    setGroups((prev) =>
                      prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                    )
                  }
                  placeholder="Column label (e.g. FR)"
                  className="border border-neutral-300 rounded px-2 py-1 text-sm flex-1"
                />
                <button
                  type="button"
                  onClick={() => setGroups((prev) => prev.filter((_, j) => j !== i))}
                  className="text-sm text-red-600 hover:underline"
                >
                  Remove
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {projects.map((p) => {
                  const owner = projectOwner.get(p.id);
                  const inThis = owner === i;
                  const usedElsewhere = owner != null && owner !== i;
                  return (
                    <label
                      key={p.id}
                      className={`text-xs border rounded px-2 py-1 cursor-pointer ${
                        inThis
                          ? "bg-neutral-900 text-white border-neutral-900"
                          : usedElsewhere
                            ? "opacity-40 cursor-not-allowed border-neutral-200"
                            : "border-neutral-300 hover:bg-neutral-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={inThis}
                        disabled={usedElsewhere}
                        onChange={() => toggleProject(i, p.id)}
                      />
                      {p.name}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </section>

        <section className="space-y-2">
          <h3 className="font-semibold text-sm">Ticket columns (order matters)</h3>
          <div className="space-y-1">
            {columns.map((c, i) => (
              <div key={c} className="flex items-center gap-2 text-sm">
                <span className="w-24 shrink-0">{COLUMN_LABEL[c]}</span>
                <input
                  value={headers[c] ?? ""}
                  onChange={(e) => setHeaders((h) => ({ ...h, [c]: e.target.value }))}
                  placeholder={`Header (default “${COLUMN_LABEL[c]}”)`}
                  className="border border-neutral-300 rounded px-2 py-0.5 text-xs flex-1"
                />
                <button
                  type="button"
                  onClick={() => setColumns((cols) => move(cols, i, -1))}
                  disabled={i === 0}
                  className="disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => setColumns((cols) => move(cols, i, 1))}
                  disabled={i === columns.length - 1}
                  className="disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => setColumns((cols) => cols.filter((x) => x !== c))}
                  className="text-red-600"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-1 pt-1">
            {ALL_COLUMNS.filter((c) => !columns.includes(c)).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColumns((cols) => [...cols, c])}
                className="text-xs border border-dashed border-neutral-300 rounded px-2 py-0.5 hover:bg-neutral-50"
              >
                + {COLUMN_LABEL[c]}
              </button>
            ))}
          </div>
        </section>

        <section className="flex flex-wrap gap-4 items-center text-sm">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={tickets} onChange={(e) => setTickets(e.target.checked)} />{" "}
            Tickets sheet
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={overview}
              onChange={(e) => setOverview(e.target.checked)}
            />{" "}
            Overview sheet
          </label>
          <label className="flex items-center gap-1 ml-auto">
            EUR rate
            <input
              value={eurRate}
              onChange={(e) => setEurRate(e.target.value)}
              placeholder="blank = no EUR"
              className="border border-neutral-300 rounded px-2 py-0.5 w-28 text-sm"
            />
          </label>
        </section>

        {preview && (
          <div className="bg-neutral-50 border border-neutral-200 rounded p-3 text-sm">
            <p className="font-medium mb-1">Preview for {input.report.label}</p>
            <ul className="space-y-0.5">
              {preview.overview.groups.map((g) => (
                <li key={g.key} className="flex justify-between">
                  <span>{g.label}</span>
                  <span>
                    {g.hours.toFixed(2)} h
                    {g.czk != null ? ` · ${g.czk.toLocaleString("cs-CZ")} Kč` : ""}
                  </span>
                </li>
              ))}
              <li className="flex justify-between font-semibold border-t border-neutral-200 pt-0.5">
                <span>Total</span>
                <span>{preview.overview.totalHours.toFixed(2)} h</span>
              </li>
            </ul>
            {preview.excludedHours > 0 && (
              <p className="mt-2 text-amber-700">
                ⚠ {preview.excludedHours.toFixed(2)} h of approved work fall outside these groups
                and won&apos;t be exported.
              </p>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={!canSave}
          className="bg-neutral-900 text-white rounded px-4 py-2 text-sm hover:bg-neutral-800 disabled:bg-neutral-300"
        >
          {selectedId === "new" ? "Create preset" : "Save changes"}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 8: Typecheck and lint**

Run: `cd web && npx tsc --noEmit && npm run lint`
Expected: no type errors, no lint errors.

- [ ] **Step 9: Manual verification (user-driven — do NOT start the dev server yourself)**

Ask the user to, in their running app (with the migration applied to their DB):

1. Open `/review/<token>/export-presets`.
2. Create a preset: name it, add an "FR" group (tick French Pimcore + SAP Spirit - FR), add a "GER" group (tick German Pimcore + SAP Spirit - DE), leave the default columns, EUR rate 24.2 → **Create preset**.
3. Confirm it appears in the preset dropdown; re-select it and confirm the form repopulates.
4. Confirm the **live preview** shows FR/GER hours (and CZK if the report has a rate), and an amber "excluded hours" note if any approved work isn't in a group.
5. Confirm a project already ticked in one group is disabled in the others.

Report any issue before committing.

- [ ] **Step 10: Commit**

```bash
git add web/src/lib/invoice-export.ts web/src/lib/invoice-export.test.ts \
  "web/src/app/review/[token]/export-presets/actions.ts" \
  "web/src/app/review/[token]/export-presets/page.tsx" \
  "web/src/app/review/[token]/export-presets/ExportPresetBuilder.tsx"
git commit -m "$(cat <<'EOF'
Add reviewer-side export preset builder with live preview

toExportInput adapter, token-auth preset CRUD, a builder page, and a
client builder that previews the export against the current report via
the pure computeExportModel (surfaces excluded hours).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Route `?preset=<id>` + review-page preset picker

**Files:**
- Modify: `web/src/app/review/[token]/export/route.ts`
- Modify: `web/src/app/review/[token]/page.tsx`

**Interfaces:**
- Consumes: `parseExportPresetConfig` (Task 1); `toExportInput`, `computeExportModel`, `DEFAULT_PRESET` (Phase 1 + Task 3); `renderWorkbook`; `prisma`.
- Produces: `GET /review/<token>/export?preset=<id>` (falls back to `DEFAULT_PRESET`); a preset picker on the approved report.

- [ ] **Step 1: Update the download route to honor `?preset=<id>`**

Replace the contents of `web/src/app/review/[token]/export/route.ts` with:

```ts
import { prisma } from "@/lib/prisma";
import { getJiraBaseUrl } from "@/lib/jira";
import {
  computeExportModel,
  DEFAULT_PRESET,
  toExportInput,
  type ExportPresetConfig,
} from "@/lib/invoice-export";
import { parseExportPresetConfig } from "@/lib/invoice-export-config";
import { renderWorkbook } from "@/lib/invoice-workbook";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const presetId = new URL(req.url).searchParams.get("preset");

  const report = await prisma.report.findUnique({
    where: { magicToken: token },
    include: {
      items: { where: { internal: false }, include: { assignments: true } },
    },
  });
  if (!report) return new Response("Not found", { status: 404 });

  let preset: ExportPresetConfig = DEFAULT_PRESET;
  if (presetId) {
    const row = await prisma.exportPreset.findUnique({ where: { id: presetId } });
    if (!row) return new Response("Preset not found", { status: 404 });
    try {
      preset = parseExportPresetConfig(row.config);
    } catch {
      return new Response("Invalid preset configuration", { status: 422 });
    }
  }

  const model = computeExportModel(toExportInput(report, getJiraBaseUrl()), preset);
  const workbook = renderWorkbook(model, preset);
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

- [ ] **Step 2: Load presets in the review page**

In `web/src/app/review/[token]/page.tsx`, after the existing `const projects = await prisma.project.findMany(...)` line, add:

```tsx
  const exportPresets = await prisma.exportPreset.findMany({
    orderBy: { name: "asc" },
  });
```

- [ ] **Step 3: Replace the Phase 1 Export link with a preset picker**

In the `locked ?` block of the "Sign off" section, replace the Phase 1 Export link:

```tsx
              {report.status === "approved" && (
                <a
                  href={`/review/${token}/export`}
                  className="inline-block bg-neutral-900 text-white rounded px-4 py-2 text-sm hover:bg-neutral-800"
                >
                  Export to Excel
                </a>
              )}
```

with a picker + manage link:

```tsx
              {report.status === "approved" && (
                <div className="space-y-2">
                  <form
                    method="get"
                    action={`/review/${token}/export`}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <select
                      name="preset"
                      className="border border-neutral-300 rounded px-2 py-1 text-sm"
                    >
                      <option value="">Default (FR/GER)</option>
                      {exportPresets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <button className="bg-neutral-900 text-white rounded px-4 py-2 text-sm hover:bg-neutral-800">
                      Export to Excel
                    </button>
                  </form>
                  <a
                    href={`/review/${token}/export-presets`}
                    className="inline-block text-sm text-neutral-500 hover:underline"
                  >
                    Manage export presets →
                  </a>
                </div>
              )}
```

(The empty-string option submits `?preset=`, which the route treats as falsy and serves `DEFAULT_PRESET`.)

- [ ] **Step 4: Typecheck and lint**

Run: `cd web && npx tsc --noEmit && npm run lint`
Expected: no type errors, no lint errors.

- [ ] **Step 5: Run the full unit suite**

Run: `cd web && npx vitest run`
Expected: all tests pass (Phase 1 + Phase 2 pure modules).

- [ ] **Step 6: Manual verification (user-driven — do NOT start the dev server yourself)**

Ask the user to, in their running app:

1. On an **approved** report, confirm the "Sign off" section shows a preset dropdown (Default + saved presets), an **Export to Excel** button, and a **Manage export presets →** link.
2. Select the saved FR/GER preset → **Export**; confirm `invoice-<label>.xlsx` downloads and matches the preview (Tickets with links, Overview FR/GER hours + CZK + live EUR).
3. Select **Default (FR/GER)** → **Export**; confirm it still downloads (route fell back to `DEFAULT_PRESET`).
4. Edit the preset to add a column (e.g. Status) and reorder columns; re-export; confirm the sheet reflects the change.

Report any mismatch before committing.

- [ ] **Step 7: Commit**

```bash
git add "web/src/app/review/[token]/export/route.ts" "web/src/app/review/[token]/page.tsx"
git commit -m "$(cat <<'EOF'
Wire export route + review page to saved presets

GET /review/[token]/export?preset=<id> renders a validated saved preset
(422 on invalid, falls back to DEFAULT_PRESET). Approved reports get a
preset picker and a link to the builder.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage (Phase 2 scope):**
- `ExportPreset` model + migration → Task 2 ✓
- `config` validation schema → Task 1 (`parseExportPresetConfig`), enforced on save (Task 3 actions) and load (Task 4 route) ✓
- Token-authenticated preset CRUD → Task 3 (`createPreset`/`updatePreset`/`deletePreset`, `requireReviewer`) ✓
- Reviewer-side builder UI: project grouping, column selection+order+headers, sheet toggles, EUR rate → Task 3 (`ExportPresetBuilder`) ✓
- Route switches from `DEFAULT_PRESET` to `?preset=<id>` → Task 4 ✓
- Surface excluded hours → Task 3 live preview (`preview.excludedHours`) ✓
- Preset reuse across months → global `ExportPreset` + picker on any approved report ✓

**Placeholder scan:** No TBD/TODO; every code/test step contains complete content.

**Type consistency:** `ExportPresetConfig`, `TicketColumnKey`, `ColumnGroup`, `ExportInput`, `computeExportModel`, `toExportInput`, `RawReport`/`RawItem`, `parseExportPresetConfig`, and the `createPreset`/`updatePreset`/`deletePreset` signatures are used with identical names/shapes across Tasks 1–4 and against the Phase 1 modules.

**Known limitations (intentional / deferred):**
- **UI/route/action tasks lean on typecheck + user browser verification**, not unit tests — this stack has no component-test harness (vitest runs in `node`, no jsdom/RTL), and server actions/route handlers need a DB. The pure logic (`parseExportPresetConfig`, `toExportInput`, `computeExportModel`, `renderWorkbook`) is unit-tested; the shell is verified by exercising the real flow.
- **Global presets, no per-client scoping.** When a second client arrives, add nullable `clientId` to `Report` + `ExportPreset` and filter the preset queries — out of scope here.
- **Weighted split ratios remain out of scope** (Phase-wide decision); the builder configures grouping/columns/rate only.
- **Column reordering is ↑/↓ buttons**, not drag-and-drop — sufficient and low-risk; revisit only if the reviewer asks.
```
