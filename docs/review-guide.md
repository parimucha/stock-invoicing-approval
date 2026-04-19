# Stock review guide

A longer version of the in-app Help popup. The in-app version lives inside
`ReviewHelpContent` in
[`web/src/app/review/[token]/page.tsx`](../web/src/app/review/[token]/page.tsx);
keep them in sync when you change wording.

## What this is

PORTA prepared this report with all the work done on Stock's account last
month. The reviewer walks through every item, approves what's correct,
adjusts project assignments where needed, and signs off. PORTA invoices
based on the approval.

Access is via a magic link, one per monthly report. No account, no
password. The token is 192 random bits; anyone with the link has full
reviewer permission on that one report.

## Page layout

```
┌────────────────────────────────────────────────────────┐
│ Header: report label · period · total hours · [Help]  │
│         status badge                                   │
├────────────────────────────────────────────────────────┤
│ Invoice overview (sticky, collapses on scroll past)    │
│   per-project totals  ·  Total  ·  PM share vs 20%     │
├────────────────────────────────────────────────────────┤
│ Filter bar (search, status pills, source, sort)        │
├────────────────────────────────────────────────────────┤
│ Items grouped by suggested project                     │
│   each card: key, type, status, summary, parent,       │
│   labels, worked/est bar, PORTA note, project ticks,   │
│   approve/reject/pending, per-item comment             │
├────────────────────────────────────────────────────────┤
│ Overall note for PORTA (optional)                      │
├────────────────────────────────────────────────────────┤
│ Sign off: Approve / Reject (or Reopen if locked)       │
└────────────────────────────────────────────────────────┘
```

## Invoice overview

Sticky at the top. Collapses to a one-line bar when you scroll past it
(per-project hours, PM share, total). Re-expands when you scroll back to
the top. Rows:

- **Unassigned / Czech Pimcore / French Pimcore / SAP Spirit** —
  per-project totals. An item assigned to multiple projects is split
  evenly across them.
- **Total** — sum of all worked minutes in the report (excluding items
  that PORTA marked internal; those don't reach the review page).
- **PM share** — percent of invoiceable time that's project management.
  Green under 20%, red over.

## Item card

Top left, in order:

- The **JIRA key** (clickable) or a **PM** badge for project-management
  work with no ticket.
- **Type** (Task / Bug / Sub-task / Scope Change Request) and **Status**
  badges come straight from JIRA.
- **Summary** — the item title.
- **Parent** — if the JIRA ticket has one.
- **Labels** — JIRA labels.

Top right:

- **X h worked** — worked hours on this item.
- **Bar**: green for the in-estimate portion, red for any time over the
  JIRA estimate.
- **est / Δ** — raw numbers: estimate and delta. Blank when no estimate.

Middle (optional):

- **Note from PORTA** (blue box) — context PORTA attached to this item.
  Read-only.
- **PM notes** (collapsible) — the raw Productive note text for PM
  items, for transparency.

Bottom-left — **Projects**: tick which project(s) this item should bill
to. Multiple ticks split the hours evenly across the selected projects.

Bottom-right — **Comment**: freeform per-item note to PORTA.

Bottom bar — **Approve / Reject / Pending**: the decision. Autosaves on
change. A small "Saved" indicator confirms persistence.

The card background is tinted green when approved, red when rejected,
white when pending.

## Filters and sort

Above the groups:

- **Search** — text match over JIRA key, summary, parent, and labels.
- **Status** pills — All / Pending / Approved / Rejected.
- **Source** pills — All / JIRA / PM.
- **Sort** — worked hours desc/asc, over-budget first, under-budget
  first, JIRA key alphabetical.

Grouping by suggested project is always on; filters hide groups that
end up empty.

## Overall note

Above the sign-off buttons, visible while the report is active. Use it
for anything that doesn't fit a specific item: "Please also split
PCM2-272 50/50 between CZ and SAP" etc.

## Sign off

Bottom of the page. Two buttons:

- **Approve report** — status → `approved`, locks editing.
- **Reject report** — status → `rejected`, locks editing.

After sign-off the card says "You have {approved/rejected} this report
on {date}." A **Reopen for review** button appears, which unlocks the
report and restores it to `under_review` without discarding your item
decisions. PORTA also has their own reopen path (to `draft`) if they
need to correct something.

Auto-save: item decisions, comments, and project assignments save
automatically. The overall note has an explicit "Save note" button.

## Troubleshooting

- **The link loads a 404** — the token is wrong or the report was
  deleted. Ask PORTA for a fresh link.
- **"This report has been {approved/rejected}. It's now read-only"** —
  you've signed off. Use **Reopen for review** in the Sign off section
  to make changes again.
- **Invoice overview looks wrong** — check that every item you care
  about has the right projects ticked. Items with no projects ticked
  land in **Unassigned** and won't be invoiced against any project.
