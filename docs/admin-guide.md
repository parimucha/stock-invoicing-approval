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
5. **Mark as sent** when ready. Share the magic link with Stock.
6. Stock reviews and signs off. You come back, read comments, invoice.

## Edit panel

Per-item, visible only while `status === "draft"`. Expand via the
**Edit** pill in the rightmost column.

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

## Invoice preview

At the top of the report detail. Computed from the current project
assignments, excluding internal items, even-split for items assigned to
multiple projects. The **PM share** bar shows what fraction of
invoiceable time is PM work; green under 20%, red over.

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
