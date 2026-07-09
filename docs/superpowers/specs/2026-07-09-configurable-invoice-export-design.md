# Configurable invoice Excel export — design

**Date:** 2026-07-09
**Status:** Approved (design), pending implementation plan
**Area:** `web/` — Stock reviewer (magic-token) side, plus a shared export engine

## Problem

The reviewer (Stock Product Owner PIM) provides materials for internal
re-invoicing inside STOCK. The mail + Excel-attachment flow and the in-app
reallocation of items (the `ProjectAssignment` checkboxes on the review page)
must stay exactly as they are. What is missing is the **last step**: after a
report is approved, the reviewer today hand-builds an Excel workbook that lists

- every ticket (with a hyperlink into JIRA),
- effort per ticket, **split across projects when a ticket is shared**, and
- the total hourly + financial split per **selected** subproject.

A sample of that hand-built workbook is
[`pim INVOICE - sap PART - 05-26.xlsx`](../../../pim%20INVOICE%20-%20sap%20PART%20-%2005-26.xlsx)
(two sheets: `Tickets` and `Overview`).

The app already computes essentially all of this substance. The
**Invoice overview** on the review page
([`web/src/app/review/[token]/ReviewItems.tsx`](../../../web/src/app/review/%5Btoken%5D/ReviewItems.tsx),
the `buckets` memo, lines ~125–141) already:

- splits a shared item's `workedMinutes` evenly across its assigned projects
  (`share = workedMinutes / assigned.length`),
- sums those shares into per-project hour buckets, and
- multiplies by `report.hourlyRateCzk` via `minutesToCzk()`.

JIRA hyperlinks already exist too (`jiraIssueUrl()` in
[`web/src/lib/jira.ts`](../../../web/src/lib/jira.ts) →
`{JIRA_BASE_URL}/browse/KEY`). So the work is not the math — it is
**serialising the already-computed state into a configurable `.xlsx`** and
giving the reviewer a way to configure it.

The reviewer explicitly wants the *configuration* to be self-serve: define
which projects roll up into which output columns, pick which columns appear,
save the setup, and reuse it every month.

## Goals

- A **pure, tested export engine** that turns a report + its assignments + an
  export configuration into a workbook model, reusing the existing even-split
  math so the file matches what the reviewer sees on screen.
- A **token-authenticated download route** on the reviewer side that streams a
  real `.xlsx` (with JIRA hyperlinks and a live EUR formula) as an attachment.
- **Configurable, saved, reusable presets** owned and edited by the reviewer:
  - **Project selection + roll-up** — pick a subset of the 9 app projects and
    group several of them into one output column (e.g. French Pimcore + SAP
    Spirit-FR → the `FR` column). One structure covers both "selected
    subprojects" and the roll-up.
  - **Columns & sheet layout** — choose which fields become Tickets columns,
    their order and header labels, and which sheets are emitted.
  - **EUR rate** for the Overview sheet (their `÷24.2`), stored on the preset.
- Ship in **two phases** (see Phasing) so a working export lands fast before
  the full builder UI is invested in.

## Non-goals (YAGNI)

- **Weighted / custom split ratios.** The engine keeps the existing *even*
  split across assigned projects. Rows like `PCM2-173` (0.15 / 0.10 in the
  sample) that reflect a manual weighted split are **not** reproduced exactly;
  the reviewer hand-tweaks those rare cells in the file. (Explicitly de-scoped
  by the client during brainstorming.)
- **Admin-side configuration.** The client chose full reviewer self-serve;
  there is no separate admin preset builder.
- **Per-client scoping.** Presets are global for now (one client today),
  mirroring how `Report` is not yet linked to `Client`. Forward path noted
  below.
- **Arbitrary sheet/formula authoring.** The column library and the two sheet
  shapes (`Tickets`, `Overview`) are fixed; the reviewer configures *within*
  them, not a free-form spreadsheet designer.
- **Emailing the file from the app.** The mail step stays manual and unchanged;
  the app only produces the download.
- **Re-deriving CZK from anything but `report.hourlyRateCzk`.** The app rate is
  authoritative; the sample's manually-typed CZK figures are not a target.

## Users and flow

The reviewer authenticates only via the report's magic token (no account).

1. Reviewer reallocates items on the review page as today.
2. Reviewer signs the report off → `approved`.
3. On the approved report the reviewer opens the **Export** panel, picks a saved
   preset (or edits/creates one), and clicks **Export to Excel**.
4. The browser downloads `invoice-<label>-<preset>.xlsx`, which the reviewer
   attaches to their approval email exactly as before.

Export is offered when the report is `approved` (the point at which the numbers
are final). Whether to also allow it during `under_review` is an open question
below.

## Architecture — four pieces

### 1. Export engine (`web/src/lib/invoice-export.ts`) — pure, tested

Split into two functions so the logic is trivially assertable:

- `computeExportModel(input, preset) → ExportModel` — **pure**, no exceljs, no
  I/O. Does all mapping, splitting, grouping, and totals. Returns a plain data
  structure (`{ ticketRows, overview, meta }`). This is what unit tests target.
- `renderWorkbook(model, preset) → ExcelJS.Workbook` — thin; turns the model
  into an exceljs workbook (cells, hyperlinks, number formats, the EUR
  formula). Minimal logic, so it needs little testing.

`input` is the already-loaded report shape:
`{ report, items (non-internal, with assignments), projects }` — the same
include the backup route uses.

### 2. Download route (`web/src/app/review/[token]/export/route.ts`)

A `GET` handler mirroring
[`web/src/app/admin/reports/[id]/backup/route.ts`](../../../web/src/app/admin/reports/%5Bid%5D/backup/route.ts):

- Authenticate by looking up the report via `magicToken` (the route's `[token]`
  is the reviewer's bearer, same as the review server actions). 404 on miss.
- Read `?preset=<id>` (Phase 2) or use the built-in default (Phase 1).
- Load report + `items (where internal=false) + assignments` + `projects`.
- `renderWorkbook(computeExportModel(...), preset)` → `workbook.xlsx.writeBuffer()`.
- Respond with the buffer,
  `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
  `Content-Disposition: attachment; filename="invoice-<label>-<preset>.xlsx"`.

The token is never logged or echoed in errors (matches the security posture in
[`docs/architecture.md`](../../architecture.md)).

### 3. Preset store — one Prisma model + token-authenticated server actions

New model in [`web/prisma/schema.prisma`](../../../web/prisma/schema.prisma):

```prisma
model ExportPreset {
  id        String   @id @default(cuid())
  name      String
  config    Json
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Presets are **global and report-independent** — defined once, applied to any
approved report at export time. This matches the data-model doc's stance that
tables are "shaped to allow per-client filtering later." Forward path: add a
nullable `clientId` to both `Report` and `ExportPreset` when a second client
appears; the export route would then only list presets for the report's client.

CRUD via server actions in `web/src/app/review/[token]/export/actions.ts`,
authenticated by token-in-FormData exactly like the existing review actions
([`web/src/app/review/[token]/actions.ts`](../../../web/src/app/review/%5Btoken%5D/actions.ts)):
`createPreset`, `updatePreset`, `deletePreset`.

### 4. Config UI (reviewer side)

A panel or sub-page at `/review/[token]/export` where the reviewer:

- names a preset;
- builds **output columns**: add a group with a label + a multi-select of the 9
  projects (a project may appear in at most one group; unpicked projects are
  excluded);
- ticks / reorders / renames the **Tickets columns** from the fixed library;
- toggles which **sheets** are emitted;
- sets the **EUR rate**;
- saves; then on any approved report picks the preset and clicks **Export**.

Follows the existing review UI conventions (Tailwind, server-action forms, low
client-JS surface).

## Data model — the `config` JSON

```jsonc
{
  "columnGroups": [                                  // ordered → column order
    { "key": "FR",  "label": "FR",  "projectIds": ["french_pimcore", "sap_spirit_fr"] },
    { "key": "GER", "label": "GER", "projectIds": ["german_pimcore", "sap_spirit_de"] }
  ],
  "ticketColumns": ["month", "country", "ticket", "description", "hours", "note"],
  "columnHeaders": { "country": "Country", "note": "Note" }, // optional per-column rename
  "sheets": { "tickets": true, "overview": true },
  "eurRate": 24.2                                    // null → omit the EUR row
}
```

A project not listed in any group is excluded from the export — this single
structure expresses both the **subset** ("selected subprojects") and the
**roll-up** (several projects → one column). A Zod/validation schema for
`config` lives alongside the engine and is enforced on preset save and on load.

## Export engine — mapping rules

Operates on **approved items only** (`approval === "approved"`). Internal items
are already excluded by the review query; pending/rejected are excluded here,
matching the on-screen invoice math.

### Tickets sheet

For each approved item:

1. `share = workedMinutes / assigned.length` — split evenly across **all**
   assigned projects (identical to the on-screen `buckets` math, so the file
   agrees with what the reviewer approved). Note this divides by the count of
   *all* assignments, including any outside the selected groups.
2. For each assigned project that belongs to a selected group, attribute
   `share` to that group. When several of an item's assigned projects map to the
   **same** group, sum their shares → **one row per (item, group)**.
3. Emit one Tickets row per (item, group) with the configured columns.

Column library (each cell nullable/blank when the source is absent):

| Column        | Source                                                          |
|---------------|-----------------------------------------------------------------|
| `month`       | month number of `report.periodStart` (sample uses `5`)          |
| `country`     | the group's `label`                                             |
| `ticket`      | `jiraKey` as a hyperlink to `{JIRA_BASE_URL}/browse/KEY`; literal `"PM"` (no link) for PM items |
| `description` | `summary` for JIRA items; blank for PM items                    |
| `hours`       | the per-group split share (numeric, Excel number format)        |
| `note`        | JIRA: `reviewerComment ?? portaNotes ?? ""`; PM: `summary`      |
| `status`      | *(optional)* `jiraStatus`                                       |
| `parent`      | *(optional)* `parentKey` / `parentSummary`                      |
| `estimate`    | *(optional)* `estimatedSeconds` → hours                         |

Row ordering: group order (from `columnGroups`), then `workedMinutes` desc
within a group — approximating the sample's layout.

### Overview sheet

Groups are **columns**; a trailing **Total** column sums them. Rows:

| Row              | Value                                                        |
|------------------|--------------------------------------------------------------|
| `SUM Hours`      | Σ of the group's Tickets-row hours                           |
| `Invoicing CZK`  | `Math.ceil(hours × report.hourlyRateCzk)` (via `minutesToCzk`) |
| `App price EUR`  | a **live formula** `=<CZK cell>/eurRate` so the client can retune the rate in the file, exactly like the sample |

If `report.hourlyRateCzk` is null the CZK and EUR rows are omitted (or left
blank) rather than guessed. If `eurRate` is null the EUR row is omitted.

## Phasing

### Phase 1 — working export, fixed preset (~½–1 day)

- Add `exceljs`.
- `invoice-export.ts` (`computeExportModel` + `renderWorkbook`) and its tests.
- The download route with a **single hardcoded default preset** matching the
  sample: `FR = {french_pimcore, sap_spirit_fr}`,
  `GER = {german_pimcore, sap_spirit_de}`,
  `ticketColumns = [month, country, ticket, description, hours, note]`,
  `eurRate = 24.2`, both sheets on.
- An **Export to Excel** button on the approved review page linking to the route.

This alone replaces the reviewer's manual workbook and meets the original
half-day time box. The exact project→country mapping in the default preset
should be confirmed with the reviewer before shipping.

### Phase 2 — self-serve configurable builder (~1.5–2 days)

- `ExportPreset` model + migration.
- `config` validation schema.
- Preset CRUD server actions (token-auth).
- The reviewer-side builder UI.
- The export route reads `?preset=<id>`; the button becomes a preset picker.

Phase 1's hardcoded preset becomes the seed/example for Phase 2.

## Error handling and edge cases

- **Report not found / wrong token** → 404, no token in the response.
- **No `hourlyRateCzk`** → Tickets still export; Overview omits CZK/EUR rows.
- **Approved item with no assignments** → belongs to no group → excluded from the
  export (its hours intentionally do not appear, since the export is
  "selected subprojects only"). Surface the count of such excluded hours in the
  UI so the reviewer is not surprised by a total that is lower than the on-screen
  figure.
- **A project mapped in a group but present on no approved item** → its group
  still appears with a zero column (predictable layout).
- **Empty result** (no approved items in any selected group) → still emit a
  valid workbook with headers and zero totals.
- **PM item assigned to a group** → renders as a `PM` Tickets row under that
  group (the sample has PM rows under both FR and GER).
- **Preset config invalid on load** (Phase 2, hand-edited/stale project ids) →
  validation error surfaced in the UI; export route returns a 422 with a safe
  message; unknown project ids in a group are ignored.

## Testing

vitest, following [`web/src/lib/report-backup.test.ts`](../../../web/src/lib/report-backup.test.ts)
and `analytics.test.ts`. Target `computeExportModel` (pure):

- even split across N assignments produces the right per-group shares;
- multiple assigned projects mapping to one group sum into a single row;
- subset behaviour: projects outside all groups are excluded, and their share is
  still removed from the numerator count (documented behaviour);
- PM vs JIRA row shape (ticket/description/note mapping, hyperlink target);
- Overview hours/CZK totals and the EUR formula string;
- null `hourlyRateCzk` and null `eurRate` omit the right rows;
- unassigned approved item is excluded and counted in the "excluded hours" meta.

One thin render test asserts `renderWorkbook` sets a hyperlink on the ticket
cell and a formula (not a literal) on the EUR cells.

## Dependencies

- **`exceljs`** (new) — hyperlinks, live formulas, number formats, runs in a
  Vercel Node function. Alternatives considered: `write-excel-file` (lighter but
  weaker formula/hyperlink ergonomics) and SheetJS/`xlsx` (licensing/registry
  friction). exceljs is the pragmatic default; revisit if bundle size on the
  route becomes a concern.

## Open questions

1. **Default project→country mapping** — confirm `FR = {French Pimcore, SAP
   Spirit-FR}` and `GER = {German Pimcore, SAP Spirit-DE}` before hardcoding the
   Phase 1 preset. (SAPS-* tickets are routed to `sap_spirit` general at ingest
   and reassigned to a country variant by the reviewer, so the country variants
   are the right grouping targets.)
2. **Export before approval?** Allow the button during `under_review`, or only
   once `approved`? Design assumes `approved` only.
3. **`month` column source** — month number of `periodStart` (matches the
   sample's `5`) vs the full `YYYY-MM` label. Assumed month number.
4. **Optional "Unassigned" column** — should the builder offer an explicit
   catch-all group for approved-but-ungrouped items, or is silent exclusion +
   an excluded-hours warning enough? Assumed the latter.
