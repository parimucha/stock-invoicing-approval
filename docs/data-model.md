# Data model

All persistent state lives in five tables defined in
[`web/prisma/schema.prisma`](../web/prisma/schema.prisma).

## Entities

### `Project` (lookup)

Fixed list, seeded by [`web/prisma/seed.ts`](../web/prisma/seed.ts):

| id              | name            |
|-----------------|-----------------|
| `czech_pimcore` | Czech Pimcore   |
| `french_pimcore`| French Pimcore  |
| `sap_spirit`    | SAP Spirit      |

Never created through the UI. To add a fourth project, edit the seed and
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
| `workedMinutes`    | sum of Productive time entries in this bucket         |
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
- Project assignments are truncated and rebuilt on each reviewer save of
  an item — the simplest way to keep "tick = on" / "untick = off" honest.

## Migrations

Migrations live in `web/prisma/migrations/`. The two changes since `init`:

| migration                        | what                                       |
|----------------------------------|--------------------------------------------|
| `20260419120000_add_porta_notes` | `ReportItem.portaNotes` (nullable TEXT)    |
| `20260419130000_add_internal_flag` | `ReportItem.internal` (BOOL, default false) |

Vercel runs `prisma migrate deploy` as part of every `build` — see
[deployment.md](deployment.md).
