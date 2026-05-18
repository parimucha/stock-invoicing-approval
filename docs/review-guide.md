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

Stock also gets a separate **client dashboard** URL
(`/client/<token>`) that lists every non-draft report with its status
and totals, with links straight into each report. Bookmark the
dashboard once and revisit instead of tracking per-report links —
the per-report links keep working either way.

## Page layout

```
┌────────────────────────────────────────────────────────┐
│ Header: report label · period · total hours · [Help]  │
│         status badge                                   │
├────────────────────────────────────────────────────────┤
│ Invoice overview (sticky, collapses on scroll past)    │
│   per-project totals · Total · Approval breakdown bar  │
│   · PM share vs 20%                                    │
├────────────────────────────────────────────────────────┤
│ Pending your review (amber card, if any)               │
│ Rejected by client  (red card, if any)                 │
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
(per-project hours, PM share, total, plus pending/rejected hour badges
when non-zero). Re-expands when you scroll back to the top.

**Only items you've explicitly approved count toward the totals.**
Pending and rejected items are excluded — they get their own cards
directly below the overview. Approving items is how you build up the
invoice; a freshly-opened report shows Total = 0 until you start
approving.

Rows:

- **Unassigned + one row per project** (Czech / French / German / Slovak
  Pimcore, SAP Spirit - general, and the four country-specific SAP Spirit
  variants) — per-project totals from approved items. Items assigned to
  multiple projects are split evenly.
- **Total** — sum of approved worked minutes.
- **Approval breakdown bar** — at-a-glance stacked bar of all logged
  hours split into Approved (green) · Pending (amber) · Rejected (red),
  with hours / percent / cost per segment.
- **PM share** — percent of invoiceable (approved-only) time that's
  project management. Green under 20%, red over.

## Pending and rejected sections

Two cards directly below the invoice overview. Each lists items with
JIRA link, summary, hours, cost, and your comment (if any).

- **Pending your review** (amber) — items you haven't approved or
  rejected yet. They don't bill until you approve.
- **Rejected by client** (red) — items you rejected. Excluded from the
  invoice; listed here so you and PORTA can see what's being dropped.

Both cards disappear once empty, so a fully-reviewed report shows just
the invoice overview.

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

> **Note:** The **Approved** radio is disabled when no projects are
> ticked — approved items must bill somewhere. If you untick the last
> project on an already-approved item, approval auto-reverts to Pending
> to keep state consistent.

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
  about is **approved** (pending and rejected items don't count) and
  has the right projects ticked. Items with no projects ticked land in
  **Unassigned**; the **Approved** radio is blocked in that case so you
  can't accidentally invoice work to nowhere.
- **Total shows 0 h on a fresh report** — that's expected. Only items
  you've explicitly approved count toward the Total. Approve items as
  you walk through them.
