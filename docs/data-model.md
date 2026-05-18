# Data model

All persistent state lives in five tables defined in
[`web/prisma/schema.prisma`](../web/prisma/schema.prisma).

## Entities

### `Project` (lookup)

Fixed list, seeded by [`web/prisma/seed.ts`](../web/prisma/seed.ts):

| id               | name                 |
|------------------|----------------------|
| `czech_pimcore`  | Czech Pimcore        |
| `french_pimcore` | French Pimcore       |
| `german_pimcore` | German Pimcore       |
| `slovak_pimcore` | Slovak Pimcore       |
| `sap_spirit`     | SAP Spirit - general |
| `sap_spirit_cz`  | SAP Spirit - CZ      |
| `sap_spirit_sk`  | SAP Spirit - SK      |
| `sap_spirit_fr`  | SAP Spirit - FR      |
| `sap_spirit_de`  | SAP Spirit - DE      |

The four `sap_spirit_*` country variants are reviewer-only buckets — every
`SAPS-*` ticket is routed to `sap_spirit` (general) at ingest, and the
reviewer reassigns to a country variant on the report page when needed.

Never created through the UI. To add another project, edit the seed and
re-run `npm run db:seed`.

### `Report`

One row per month. Uniquely keyed by `label` (e.g. `2026-03`).

Key columns:

| column                 | notes                                              |
|------------------------|----------------------------------------------------|
| `label`                | `YYYY-MM`, unique                                  |
| `periodStart/End`      | DATE columns                                       |
| `productiveBudgetName` | audit only, surfaces in the admin header           |
| `status`               | enum: `draft` → `sent` → `under_review` → `approved` / `rejected` |
| `magicToken`           | 192-bit base64url, unique index                    |
| `reviewerNote`         | optional overall note Stock can leave              |
| `sentAt / reviewedAt`  | lifecycle timestamps                               |

### `ReportItem`

One row per reviewable line. Either JIRA-linked (`source = jira`) or
project-management (`source = project_management`, no JIRA key).

| column             | notes                                                 |
|--------------------|-------------------------------------------------------|
| `summary`          | for JIRA items the JIRA summary; for PM items synthesized from Productive notes. Editable (PM only) via admin. |
| `workedMinutes`    | sum of Productive time entries in this bucket (the invoiced month) |
| `totalWorkedMinutes` | lifetime minutes on this JIRA key across all Stock months/deals. Reference only — not used for invoicing. Set at ingest from `pull-productive-totals.js`; nullable for PM items, manually-added items, and reports built before the totals pull existed. |
| `estimatedSeconds` | JIRA `timeoriginalestimate`, nullable                 |
| `jiraIssuetype / Status / Labels` | cached JIRA metadata from ingest time  |
| `parentKey / parentSummary`       | JIRA parent, for context and mapping   |
| `pmNotes`          | concatenated raw Productive note text for PM items    |
| `portaNotes`       | admin-authored context, shown to reviewer read-only   |
| `internal`         | if true, hidden from the reviewer entirely            |
| `suggestedProjects`| ingest-time project ids; used by "Reset" to restore  |
| `approval`         | enum: `pending` / `approved` / `rejected`            |
| `reviewerComment`  | per-item note from Stock                              |

### `ProjectAssignment`

Many-to-many between items and projects. Composite primary key
`(itemId, projectId)`. Edited through the review UI; "Reset report"
rebuilds this table from `suggestedProjects`.

## Report lifecycle

```
                         ┌──────────┐
                         │  draft   │◀────────────────┐
                         └────┬─────┘                 │
                              │ mark as sent          │
                              ▼                       │
                         ┌──────────┐                 │
                         │   sent   │                 │ reopen as draft
                         └────┬─────┘                 │ (admin)
                              │ reviewer opens link   │
                              ▼                       │
                         ┌──────────┐                 │
                ┌───────▶│ under_   │─────────────────┤
reopen for      │        │ review   │                 │
review (Stock)  │        └────┬─────┘                 │
                │             │                       │
                │      ┌──────┴──────┐                │
                │      ▼             ▼                │
                │ ┌────────┐   ┌──────────┐           │
                └─│approved│   │ rejected │───────────┘
                  └────────┘   └──────────┘
```

- **Admin edits** (summary, PORTA notes, merge, internal, reset) require
  `status === "draft"`. Use "Reopen as draft" to unlock a later-stage
  report.
- **Reviewer edits** (approval, comment, project assignment, overall note)
  require `status` ∈ `{sent, under_review}`.
- First visit to the magic link when `status = sent` bumps it to
  `under_review` (see `web/src/app/review/[token]/page.tsx`).
- Sign-off moves to `approved` / `rejected` and locks both sides. Either
  party can reopen to `under_review` (Stock) or `draft` (PORTA).

## Invariants worth remembering

- A PM item can be **merged into** any JIRA or PM item in the same report.
  The source row is deleted; its minutes are added to the target;
  `pmNotes` are concatenated.
- Items marked `internal = true` are excluded server-side from the review
  page query and from both invoice previews client-side.
- Only items with `approval = "approved"` count toward the invoice total,
  per-project buckets, and PM share. Pending and rejected are surfaced
  separately and excluded from the math. Internal still wins over
  approval state (internal-and-rejected counts as internal) so the
  categorization stays non-overlapping.
- Project assignments are truncated and rebuilt on each reviewer save of
  an item — the simplest way to keep "tick = on" / "untick = off" honest.
- The admin "Project group" action (`updateItemGroup`) writes both
  `suggestedProjects` and `ProjectAssignment` in one transaction. Earlier
  drafts wrote only the suggestion, which left items visually under a
  group while contributing zero to that group's bucket — the bug that
  produced the orphan invoice rows in early reports.
- Server gate: `saveItem` rejects `approval = "approved"` with zero
  `projectIds`. The client UI also disables the Approved radio in that
  case, but the server is the authoritative check.

## Migrations

Migrations live in `web/prisma/migrations/`. Since the initial schema
(`20260417155426_init`):

| migration                                       | what                                                |
|-------------------------------------------------|-----------------------------------------------------|
| `20260419120000_add_porta_notes`                | `ReportItem.portaNotes` (nullable TEXT)             |
| `20260419130000_add_internal_flag`              | `ReportItem.internal` (BOOL, default false)         |
| `20260504_add_german_pimcore_project`           | seeds the German Pimcore project row                |
| `20260504_add_hourly_rate`                      | `Report.hourlyRateCzk` (nullable INT)               |
| `20260507_add_slovak_and_sap_spirit_variants`   | seeds Slovak Pimcore + four country SAP Spirit rows |
| `20260507_add_total_worked_minutes`             | `ReportItem.totalWorkedMinutes` (nullable INT)      |

Vercel runs `prisma migrate deploy` as part of every `build` — see
[deployment.md](deployment.md).
