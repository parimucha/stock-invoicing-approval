# PORTA admin guide

The admin side lives under `/admin` and is gated behind a password (set via
`ADMIN_PASSWORD`). Every admin server action re-checks the session — the
layout gate is not the only line of defense.

## Monthly flow

1. Run the [ingestion pipeline](ingestion.md) → get `report.json`.
2. **Upload** at `/admin/upload`. Paste the JSON or attach the file. If a
   report with the same `label` already exists:
   - `draft` / `sent` → it's replaced in place.
   - `under_review` / `approved` → blocked. Reopen it to `draft` first.
3. You land on the report detail at `/admin/reports/<id>`. A magic link is
   shown at the top — copy it.
4. **Edit** items as needed (see below).
5. **Mark as sent** when ready. Share the magic link with Stock — or just
   tell them their dashboard now has a new row (see "Client dashboard"
   below).
6. Stock reviews and signs off. You come back, read comments, invoice.

## Client dashboard

`/admin` shows a **Client dashboards** section at the top with one URL
per client (today: just Stock) of the form
`/client/<magicToken>`. The dashboard lists every non-draft report with
per-report status, approved/pending/rejected hour totals, invoiced
cost (when the per-report hourly rate is set), and a link straight to
that report's individual magic-link review page.

Share the dashboard URL **once** per client; they bookmark it and
revisit. Every new report you mark as sent shows up automatically.
The per-report magic link still works directly for anyone who already
has it — the dashboard is an entry point, not a replacement.

The token is seeded once on first deploy (via `prisma/seed.ts`) and
preserved across re-seeds — re-running the seed doesn't rotate the
URL. To rotate, delete the `Client` row in the DB and re-seed.

## Edit panel

Per-item, visible only while `status === "draft"`. Expand via the
**Edit** pill in the rightmost column.

### Project group

The single-select dropdown at the top of the edit panel. Sets both the
section the reviewer sees the item under **and** the project it bills
to — the two are kept in sync. Picking a project overwrites any prior
multi-project assignment the reviewer may have set (matches what
clicking a single-project dropdown implies); picking Unassigned clears
all assignments. The reviewer can still re-tick multiple projects on
their side to split.

### PORTA notes

Free-text field, available on **every** item (JIRA or PM). Saves a blue
"Note from PORTA" box that the reviewer sees read-only on the review
card. Use it to pre-empt confusion: "This was QA pairing that ran long
because of the upstream outage on the 12th," etc. Also renders inline in
the summary cell so you can see at a glance which rows already have
notes.

### Summary rename (PM items only)

PM items get their summary synthesized from the Productive note at
ingest. If the result is ugly or unclear ("Meeting 15.3 about SAP"), you
can rewrite it. JIRA summaries are **not** editable — they come from
JIRA and should stay canonical.

### Merge into… (PM items only)

Picks any other item in the report (JIRA or PM) as the merge target.
Source worked-minutes are added to the target; source `pmNotes` (and
the source `summary` if it differs from the target's) are appended to
the target's notes with a blank-line separator. The source row is
deleted.

Use cases:

- A developer forgot to paste the JIRA key — you see a PM item that
  clearly belongs to a ticket already in the report. Merge it.
- Two PM items are the same work under slightly different note text —
  merge them into one.

There's no undo. The re-upload fallback works for big mistakes. For
single-merge mistakes, note that minutes + notes are concatenated, so
the information isn't lost — you'd just have to split by hand.

### Mark as internal

Toggles `ReportItem.internal`. Internal items are **completely hidden**
from the review view — they don't appear in the item list and don't
contribute to the reviewer's invoice overview. On the admin side, rows
are muted and tagged with an amber "Internal" badge. The admin invoice
preview excludes them from the per-project totals and shows their total
on a separate "Internal (hidden from client)" row.

Semantics: internal items are **not invoiced to the client**. If you
need an item hidden but still billable, that's a different feature —
not supported today.

## Add item manually

Collapsible section above the items table, visible while `status ===
"draft"`. Use it for work that was logged outside Productive (e.g. a
fixed-fee add-on) or for any line item the ingest pipeline missed.
Fields: summary, hours worked (decimal), optional JIRA key, optional
PORTA notes, optional suggested projects, internal flag. Creates a
ReportItem plus matching ProjectAssignment rows in one transaction.

## Manual hourly rate

Optional. Set CZK/hour on the report; costs round up to whole crowns and
appear alongside every hours figure for that report (invoice preview,
per-item rows, lifetime totals, reviewer's overview). Leave blank to
hide costs entirely. Saved per-report so different months can use
different rates.

## Refresh from upstream

Two non-destructive buttons above the invoice preview. Both touch a
single field each — admin/reviewer edits are untouched.

- **Refresh lifetime totals** — hits Productive directly for every
  JIRA-linked item, recomputes the lifetime "X h total" reference shown
  next to each item's monthly hours. Targeted by JIRA key (one query per
  key, 8-way concurrency, bounded so it fits a Hobby 10s budget for a
  typical 30–100-key report). Requires the `PRODUCTIVE_*` env vars; if
  not set, the button surfaces a config error when clicked.
- **Refresh JIRA statuses** — hits the Atlassian REST API for every
  JIRA-linked item (batched JQL `key in (…)`, 50 keys/batch, only the
  `status` field). Routes through `api.atlassian.com/ex/jira/{cloudId}/…`
  rather than the site URL because scoped API tokens silently return
  empty results from the site URL. Requires `JIRA_BASE_URL`,
  `JIRA_API_EMAIL`, `JIRA_API_TOKEN`.

Either button reports `N updated · M unchanged · K not in {Productive,JIRA}`
after the run.

## Invoice preview

Below the refresh + hourly rate sections. Computed from the current
project assignments, even-split for items assigned to multiple projects.
**Only items the client has explicitly approved are counted** — items
still pending review, rejected by the client, and marked internal each
get their own row below the invoiceable total but contribute zero.

Above the per-project table:

- **Approval breakdown bar** — stacked horizontal segment bar with hours
  / percent / cost for each of Approved · Pending · Rejected · Internal,
  summing to total logged hours. Same colour key as the rest of the
  page.
- **PM share** — fraction of *invoiceable* (approved-only) time that's
  PM work; green under 20%, red over.

Below the preview:

- **Pending client review** card — per-item breakdown of pending items
  (JIRA key, summary, hours, cost, reviewer comment if any). Excluded
  from the invoiceable total until approved.
- **Rejected by client** card — same shape, red instead of amber. Also
  excluded from the invoiceable total.

Both cards render nothing when empty, so a clean report shows just the
invoice preview.

## Status actions

Right under the magic link:

- **Mark as sent** (from `draft`): moves status to `sent`, records
  `sentAt`.
- **Reopen as draft** (from any non-draft): moves status back to
  `draft`, clears `sentAt` and `reviewedAt`. Item-level approvals and
  comments are **preserved** — if you reopen after the reviewer signed
  off and make a small change, then mark as sent again, their earlier
  decisions are still there.
- **Reset report** (always available): destructive. Status back to
  `draft`, all item approvals back to `pending`, all reviewer comments
  cleared, the overall reviewer note cleared, project assignments
  restored to `suggestedProjects`. Admin-side edits (PORTA notes,
  renamed summaries, merges, internal flags) are **kept**. Primarily a
  testing tool. Confirmation prompt.

## Backup & restore

A report can be exported as a single self-contained JSON file and re-imported
later — to move it between environments, keep an off-system copy, or roll back
to a known-good state. Unlike the ingestion upload (which only carries
source data and resets review state), a backup captures **everything**: status,
the client magic link, item approvals, reviewer comments, PORTA notes, the
overall reviewer note, and project assignments.

- **Download backup** — button in the report's status-action row at
  `/admin/reports/<id>`. Available in any status. Downloads
  `backup-<label>-<date>.json` containing the full report, all items, and the
  definitions of every project they reference.
- **Restore from backup** — the second form on `/admin/upload` ("Restore from
  backup"). Paste or attach a backup file. On restore:
  - Any projects the backup references are created if missing (existing
    projects are left untouched).
  - If a report with the same embedded id — or, failing that, the same `label`
    (month) — already exists, it is **restored in place**: the existing report
    is replaced, **reusing the same id and the same magic link** so links you've
    already shared keep working.
  - Otherwise a **new** report is created. The backup's magic link is kept
    unless another report already uses it, in which case a fresh one is minted.
- **Overwrite confirmation** — restoring over a report that is currently
  `under_review` or `approved` overwrites the client's live approvals and
  comments. That requires ticking the confirmation checkbox on the form; without
  it, the restore is refused. (This differs from the ingestion upload, which
  simply blocks replacing in-review/approved reports.)
- **Conflicts** — if restoring would collide with a *different* report's unique
  `label` or magic token, the restore is refused with a message rather than
  guessing. Resolve by renaming or removing the other report first.

Errors (bad JSON, a failed validation, a conflict, or a missing confirmation)
surface the same way the ingestion upload's errors do.

## Filters and sort

Above the items table. Same controls as the review view: search, status
pills, source pills (JIRA / PM), and sort options (worked desc/asc,
over budget, under budget, JIRA key).

## After sign-off

Once Stock approves or rejects:

- Status is locked on both sides.
- You can still reopen to `draft` to make corrections.
- The magic link continues to work (read-only for Stock until you
  re-send).
- Invoice from the per-project totals on the admin invoice preview.
