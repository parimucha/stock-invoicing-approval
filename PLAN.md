# Stock Monthly Invoicing Report — Plan

## Goal
Replace the manual monthly Excel-based process with a small web app where:
- **PORTA** generates the report once a month from Productive + JIRA.
- **Stock** reviews every worked item, adjusts project assignment, approves/rejects, and signs the whole report off.
- PORTA invoices based on the approved per-project totals.

## Constraints
- No live API calls from the hosted app — all JIRA/Productive reads happen **locally via MCP in Claude Code** once a month.
- Hosted on PORTA's Cloudways, served under `profi.ci`.
- "Not unnecessarily complicated, easy to maintain."
- Single PORTA user (you). Single Stock reviewer per report (magic link).

## High-level architecture

```
┌───────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ Local: Claude     │    │ Hosted web app   │    │ Stock reviewer   │
│ Code + MCP        │    │ (Cloudways)      │    │ (browser, magic  │
│                   │    │                  │    │  link)           │
│ - Pull Productive │    │ - PORTA admin    │    │ - Review items   │
│   work log for    │──▶ │   (password)     │──▶ │ - Approve/reject │
│   budget/month    │    │   uploads JSON   │    │ - Comment        │
│ - Pull JIRA meta  │    │ - Stores months  │    │ - Adjust project │
│ - Emit JSON       │    │ - Generates link │    │ - Sign off       │
└───────────────────┘    └──────────────────┘    └──────────────────┘
```

Two pieces, loosely coupled via a **report JSON file**:
1. **Local ingestion** (Claude Code session, using MCP).
2. **Hosted web app** (review, approval, archive).

## Tech stack

- **Framework:** Next.js 15 (App Router, TypeScript). Server components + server actions keep the app close to "forms that post" — minimal client JS, low maintenance surface.
- **Database:** MySQL. Works on Cloudways and runs cleanly in Docker for local dev.
- **ORM:** Prisma — schema file drives migrations and types.
- **Styling:** Tailwind CSS.
- **Auth:**
  - PORTA admin — single password (env var), simple login form, cookie session.
  - Stock reviewer — opaque magic link token per report, no account.
- **Local dev:** `docker compose` with two services (`app`, `db`). One command up, matches what will ship.
- **Deploy:** target is Cloudways under `profi.ci` subdomain. Exact method (Cloudways Node app vs. containerized) to be verified once we check what Cloudways currently supports — decide after local version works.

## Data model

### `reports`
| field | type | notes |
|---|---|---|
| id | pk | |
| label | string | e.g. `2026-04` |
| period_start / period_end | date | |
| productive_budget_id / name | string | for audit |
| status | enum | `draft`, `sent`, `under_review`, `approved`, `rejected` |
| magic_token | string | random, used in review URL |
| created_at, sent_at, reviewed_at | datetime | |
| reviewer_note | text | optional overall comment from Stock |

### `report_items`
| field | type | notes |
|---|---|---|
| id | pk | |
| report_id | fk | |
| source | enum | `jira` or `project_management` |
| jira_key | string? | e.g. `PCM2-272`, null for PM |
| summary | string | from JIRA, or synthesized from Productive note for PM |
| worked_hours | decimal | sum from Productive |
| estimated_hours | decimal? | from JIRA estimate |
| diff_hours | decimal? | estimated − worked (computed; can also be done client-side) |
| jira_labels | json | raw labels |
| parent_key / parent_summary | string? | from JIRA |
| pm_notes | text? | concatenated/summarized Productive notes for PM items |
| suggested_projects | json | derived from labels at ingest time |
| assigned_projects | json | editable by Stock; defaults to suggested |
| approval | enum | `pending`, `approved`, `rejected` |
| reviewer_comment | text? | |

### `projects` (fixed lookup, seeded)
- `czech_pimcore` — "Czech Pimcore"
- `french_pimcore` — "French Pimcore"
- `sap_spirit` — "SAP Spirit"

## Label → project mapping (fuzzy)

Hard-coded rules, case-insensitive substring match on JIRA labels:

| Project | Matches any of |
|---|---|
| Czech Pimcore | `cz`, `czech` |
| French Pimcore | `fr`, `french`, `france` |
| SAP Spirit | `sap` |

Rules applied during ingestion to set `suggested_projects`. Outcomes:
- 0 matches → empty, Stock picks.
- 1 match → pre-selected, Stock can change.
- 2+ matches → all pre-selected, Stock confirms/edits.
- PM items (no JIRA) → empty, Stock assigns.

**Billing split:** when an item has N assigned projects, its `worked_hours` is split **evenly** (1/N per project) in the invoice overview.

## Local ingestion flow (monthly)

Run in Claude Code in this repo:

> "Generate report for April 2026."

Claude Code:
1. Uses Productive MCP to find the Stock monthly budget for the period → lists time entries.
2. Groups entries:
   - With JIRA key in task name/description → grouped by JIRA key.
   - Without JIRA key → bucketed as PM items, **grouped primarily by the Productive note**. Final grouping rule (e.g. exact match, normalized match, fallback to task name when note is empty) will be decided once we pull a real month and see the data.
3. For each JIRA key, uses JIRA MCP to fetch: summary, estimate, labels, parent.
4. Applies the label → project mapping to produce `suggested_projects`.
5. Writes `reports/<YYYY-MM>.json` locally, matching the schema above.
6. User uploads JSON via PORTA admin page.

No API tokens stored in the app. MCP handles auth in the Claude Code session.

## Web app pages

### PORTA admin (password-protected)
- **Reports list:** all months, status, sent/reviewed dates, link to each.
- **New report:** upload JSON → creates `report` + `report_items`, generates magic link, copy-to-clipboard.
- **Report detail (PORTA view):** same data as the client view but read-only, shows every item's approval state and Stock's comments. Resend link, mark sent.

### Stock review (magic link, no login)
- **Report page:** list of items grouped by suggested project (and "Unassigned" bucket for items with no labels).
  - Each row shows: JIRA key + link (if any), summary, worked, estimate, diff, labels, parent, assigned projects (multi-select checkboxes), approve/reject toggle, comment field.
  - Save happens inline (AJAX with Alpine) so nothing is lost.
- **Invoice overview button:** recomputes per-project totals from **approved** items, applying the even-split rule. Renders a clean table Stock can show internally.
- **Sign-off:** two buttons at the bottom — `Approve report` / `Reject report` — plus an optional overall note. Flips `reports.status` and locks the report.

### Archive
- Past months are read-only for both sides.
- Accessed via the reports list; the magic link continues to work (also read-only once signed off).

## Report lifecycle / states

```
draft → sent → under_review → approved
                           ↘ rejected
```

- `draft`: just uploaded, not sent.
- `sent`: link shared with client.
- `under_review`: client opened/edited items but hasn't signed off.
- `approved` / `rejected`: locked. PORTA sees final state and invoices.

## Out of scope for v1

- PDF/CSV export (said "just display" for now).
- Multiple PORTA users / SSO.
- Pushing approvals back to JIRA/Productive.
- Email sending (magic link copied/pasted manually by you).
- Live re-sync with Productive/JIRA mid-review (each month is standalone; a fresh upload replaces the report).

## Decisions made

1. **Framework:** Next.js (TypeScript).
2. **Local dev:** Docker (`app` + `db`). Production deploy method decided later based on what Cloudways supports.
3. **PM grouping:** primarily by Productive note; finalize the rule after a real data pull.
4. **Re-upload behavior:** replace if status is `draft` or `sent`; block if `under_review` or `approved` (force explicit unlock if ever needed).
5. **Magic link:** never expires. Report is locked once signed off, so a live link is read-only.

## Proposed build order

1. **Real data pull first.** Run a Claude Code + MCP session against **March 2026** (the month actually needing review), dump raw Productive entries + JIRA metadata to a local JSON. This informs the PM grouping rule and flushes out surprises before we write app code.
2. Scaffold Next.js + Prisma + Docker Compose; define schema, migrate, seed the three fixed projects.
3. PORTA admin: password login, reports list, JSON upload → creates report + items. Read-only report detail.
4. Client review page via magic link: grouped items, inline approve/reject, comment, project reassignment with autosave.
5. Invoice overview: per-project totals with even-split rule, triggered from a button.
6. Sign-off flow: approve/reject the whole report, lock on final status.
7. Archive polish: past-month read-only view, consistent for both sides.
8. Build the ingestion prompt/script for Claude Code + MCP that produces the JSON matching the schema.
9. Check Cloudways capabilities, deploy, wire up `profi.ci` subdomain.
10. Dry run with real March 2026 data end-to-end, iterate.
