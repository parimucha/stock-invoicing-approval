# Report backup / restore — design

**Date:** 2026-06-03
**Status:** Approved (design), pending implementation plan
**Area:** `web/` — PORTA admin

## Problem

PORTA needs to work with a report as a whole, self-contained package: download a
complete backup of a single report and upload it again to **create a new report**
or **update (restore) an existing one**. The backup must capture the *complete*
state — not just the ingestion source data, but every piece of review state:
PORTA notes, client approvals and comments, project assignments, status, and the
client-facing magic link.

This is distinct from the existing monthly **upload** flow
([`web/src/app/admin/upload/page.tsx`](../../../web/src/app/admin/upload/page.tsx)),
which ingests `report.json` from the local pipeline. That contract
([`web/src/lib/report-schema.ts`](../../../web/src/lib/report-schema.ts))
deliberately carries only source fields and resets all review state on every
upload. A backup is a richer, faithful snapshot.

## Goals

- Download one report as a single self-contained `.json` file capturing all state.
- Upload a backup to create a new report (no match) or restore over an existing
  one (match), preserving review state and the client magic link.
- Be portable across databases — restoring into a fresh/empty DB must not leave
  dangling project assignments.

## Non-goals (YAGNI)

- Whole-database / multi-report backup in one file. (One report per file. A
  "backup everything" button can come later if a real need appears.)
- Binary attachments / zip bundles. The data model has none.
- Backup of `Client` rows or `Project` definitions as a standalone feature. The
  backup only carries the `Project` definitions its own items reference, so it
  can restore assignments anywhere.

## Decisions (from brainstorming)

| Decision | Choice |
| --- | --- |
| Scope | **One report per file.** |
| Create-vs-update match key | **Embedded report `id`, falling back to unique `label`.** |
| Restore semantics | **Preserve `magicToken` + full review state** (faithful restore). |
| Destructive-restore guard | **Allow overwriting `under_review`/`approved`, but require explicit confirmation** (not silently blocked). |
| Label collision on create | **Error clearly**; do not guess. |

## File format

Single self-contained JSON file. Envelope carries `schemaVersion` (forward-compat)
and `exportedAt`. Suggested filename: `backup-<label>-<YYYY-MM-DD>.json`.

```jsonc
{
  "schemaVersion": 1,
  "exportedAt": "2026-06-03T12:00:00.000Z",
  "report": {
    "id": 7,                         // embedded match key
    "label": "2026-05",
    "periodStart": "2026-05-01",     // YYYY-MM-DD
    "periodEnd": "2026-05-31",
    "productiveDealId": "3624023",
    "productiveBudgetName": "stock.cz_design&development (2026/05)",
    "hourlyRateCzk": 1500,
    "status": "under_review",
    "magicToken": "…",               // preserved on restore
    "reviewerNote": "…",
    "createdAt": "2026-06-01T08:00:00.000Z",
    "sentAt": "2026-06-01T09:00:00.000Z",
    "reviewedAt": null,
    "items": [
      {
        "source": "jira",
        "jiraKey": "PCM2-123",
        "summary": "…",
        "workedMinutes": 120,
        "totalWorkedMinutes": 480,
        "estimatedSeconds": 3600,
        "jiraIssuetype": "Task",
        "jiraStatus": "Done",
        "jiraLabels": ["…"],
        "parentKey": "…",
        "parentSummary": "…",
        "pmNotes": "…",
        "portaNotes": "…",
        "internal": false,
        "suggestedProjects": ["proj-a"],
        "approval": "approved",
        "reviewerComment": "…",
        "assignedProjects": ["proj-a", "proj-b"]   // resolved ProjectAssignment rows
      }
    ]
  },
  "projects": [                        // definitions for every project id referenced
    { "id": "proj-a", "name": "Design", "sortOrder": 0 }
  ]
}
```

### Field coverage

The format mirrors the Prisma model
([`web/prisma/schema.prisma`](../../../web/prisma/schema.prisma)) one-to-one:

- **Report**: all columns including `status`, `magicToken`, `reviewerNote`, and
  the timestamps (`createdAt`, `sentAt`, `reviewedAt`).
- **ReportItem**: all columns including the review-state fields the ingestion
  contract omits — `portaNotes`, `internal`, `approval`, `reviewerComment` — plus
  `assignedProjects` (the actual `ProjectAssignment` rows, distinct from
  `suggestedProjects`).
- **projects[]**: `id`, `name`, `sortOrder` for every project id referenced by
  any item's `suggestedProjects` or `assignedProjects`. Makes the file portable.

`Client` rows are not included; the magic link lives on the report itself.

## Components

### 1. Backup serializer — `web/src/lib/report-backup.ts`

- `serializeBackup(report)`: takes a report loaded with `items` (incl.
  `assignments`) and the referenced `projects`, returns the JSON envelope above.
- `parseBackup(input: unknown): ParsedBackup`: validates `schemaVersion`, the
  report shape, item shapes, and project shapes; throws clear errors. Kept
  separate from `parseUploadReport` so the two contracts (ingestion vs. backup)
  stay independent and self-documenting.

### 2. Download — admin route

- A **"Download backup"** button on the report detail page
  ([`web/src/app/admin/reports/[id]/page.tsx`](../../../web/src/app/admin/reports/[id]/page.tsx)).
- A route handler (e.g. `web/src/app/admin/reports/[id]/backup/route.ts`) guarded
  by `requireAdmin()`, loads the report with `items → assignments` and the
  referenced projects, calls `serializeBackup`, and streams it with
  `Content-Disposition: attachment; filename="backup-<label>-<date>.json"`.
- Available in any status.

### 3. Upload / restore — extends the upload screen

- Add a **"Restore from backup"** mode to
  ([`web/src/app/admin/upload/page.tsx`](../../../web/src/app/admin/upload/page.tsx)),
  alongside the existing ingestion upload, with its own server action.
- Server action (guarded by `requireAdmin()`):
  1. `parseBackup(JSON.parse(text))`.
  2. **Ensure projects exist** — `upsert` each `projects[]` entry by `id` (create
     if missing, leave existing untouched). Fixes restore into an empty DB.
  3. **Match** — find existing report by embedded `report.id`; if none, match by
     unique `label`.
     - **No match → create** a new report. Preserve `magicToken` and all state.
       If `label` collides with a *different* existing report, **error**
       (`"A different report already uses label <label>"`). If the backup's
       `magicToken` is already taken by another report (e.g. duplicating a backup
       into the same DB), mint a fresh token instead of failing — only the
       restore-in-place path keeps the original token verbatim.
     - **Match → replace in place**: delete the existing report row (cascade
       removes items + assignments), recreate with the same `id` and
       `magicToken`, restoring full state.
  4. Redirect to `/admin/reports/<id>`.
- **Destructive-restore guard**: when restoring over an existing report whose
  status is `under_review` or `approved`, require an explicit confirmation
  (checkbox or typed confirm) acknowledging it overwrites live client-facing
  state. Without confirmation, the action refuses.

### Restore-in-place transaction

Replace must be atomic so a failure can't leave the report half-deleted. Wrap the
delete + recreate in a single `prisma.$transaction`. Recreating with an explicit
`id` requires inserting the report with its `id` set (Prisma allows setting an
`@id @default(autoincrement())` field explicitly). The Postgres identity sequence
is not consulted for explicit ids, so reusing the old id is safe for restore.

## Data flow

```
Download:  report detail → GET backup route → load (report+items+assignments+projects)
           → serializeBackup → .json attachment

Restore:   upload screen (restore mode) → server action → parseBackup
           → upsert projects → match by id|label
           → create new  (preserve token/state, error on label collision)
           or replace in place inside $transaction (preserve id + token + state)
           → redirect to report
```

## Error handling

- `parseBackup` throws on: non-object input, unknown/missing `schemaVersion`,
  missing required report fields, malformed dates, non-array `items`/`projects`,
  invalid enum values (`status`, `source`, `approval`), bad numeric fields.
- Restore errors on label collision (embedded id unmatched, label taken by a
  different report).
- Restore over `under_review`/`approved` without confirmation → refused with a
  clear message.
- Errors surface on the upload screen the same way the existing upload errors do.

## Testing

- **Round-trip**: seed a report with full review state (approvals, comments,
  PORTA notes, assignments, non-default status, magic token) → serialize → wipe →
  `parseBackup` + restore → assert deep equality of id, magicToken, status,
  every item field, and assignment sets.
- **Fresh-DB restore**: import into a DB with no matching projects → the
  referenced projects are created and assignments resolve.
- **Create-new**: backup whose embedded id matches nothing and whose label is
  free → creates a new report preserving token/state. A second create from the
  same backup (token already taken) → succeeds with a freshly minted token.
- **Label collision**: embedded id unmatched, label taken by a different report →
  errors, no write.
- **Confirmation guard**: restore over an `approved` report without confirmation
  → refused; with confirmation → succeeds.
- **Bad envelope**: wrong/absent `schemaVersion`, malformed JSON, missing fields
  → rejected with clear messages.

## Open considerations

- `schemaVersion` starts at `1`. Future field additions bump it; `parseBackup`
  can branch on version if the shape ever changes.
- No migration required — this feature adds no columns and changes no schema.
