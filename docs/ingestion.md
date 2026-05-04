# Ingestion pipeline

The monthly process that turns Productive time entries + JIRA metadata into
a single `report.json` uploaded to the web app.

> **For the exact runbook with commands, see
> [`scripts/README.md`](../scripts/README.md).** That file is the
> source of truth; this doc is the conceptual overview.

## Inputs

- Productive **deal id** for the month's budget (e.g. `3624023` for
  `stock.cz_design&development (2026/03)`).
- The period in `YYYY-MM-DD` form.
- Atlassian MCP connected in Claude Code.
- `.env` at the repo root with `PRODUCTIVE_API_TOKEN` and
  `PRODUCTIVE_ORG_ID`.

## Output

```
data/<YYYY-MM>/
├── raw/
│   ├── productive-entries.json    ← step 1
│   └── jira-issues.json           ← step 3
└── report.json                    ← step 4, uploaded in step 5
```

Everything under `data/` is git-ignored. Raw dumps stay on disk for audit;
only `report.json` is uploaded.

## Pipeline

1. **Pull Productive entries** via the raw REST API — not the Productive
   MCP wrapper, which strips the JIRA integration fields we need.
   [`scripts/pull-productive-entries.js`](../scripts/pull-productive-entries.js)
   paginates every entry on the deal in the date range, flattens
   relationships, and records the JIRA key. Key resolution order:
   1. Productive's native `jira_issue_id` field.
   2. Regex over the note text (`\b[A-Z][A-Z0-9]+-\d+\b`) when (1) is empty.

   Each entry carries a `jira_key_source` tag (`productive_field` /
   `note_regex`) so the path is auditable.

2. **Collect distinct JIRA keys** from the entries.

3. **Pull JIRA metadata** via Claude Code with the Atlassian MCP. Batched
   JQL (`key in (K1, K2, …)`) in groups of ~10 keys. Fetched fields:
   summary, status, issuetype, labels, parent key + summary,
   `timeoriginalestimate`. Written to `data/<YYYY-MM>/raw/jira-issues.json`.

4. **Build the report** with
   [`scripts/build-report.js`](../scripts/build-report.js). The script:
   - Groups entries by `jira_key` (JIRA items) or normalized Productive
     note (PM items).
   - Sums worked minutes per group.
   - Applies the project-mapping rules (next section).
   - Emits `data/<YYYY-MM>/report.json` shaped as
     [`UploadReport`](../web/src/lib/report-schema.ts).

5. **Upload** via the admin UI at `/admin/upload`.

## Project mapping rules

Evaluated top-to-bottom; first match wins for the strong rules. Multiple
label matches can stack.

1. JIRA key prefix `SAPS-` → SAP Spirit (always).
2. Parent issue:
   - `PCM2-91` (PIM CZ) → Czech Pimcore
   - `PCM2-92` (PIM FR) → French Pimcore
   - `PCM2-229` (PIM DE) → German Pimcore
   - `PCM2-124` (PIM SK) → Unassigned (Slovak isn't one of the projects)
   - any other parent → skip, go to labels
3. Labels (weak fallback):
   - `CZ` → Czech Pimcore
   - `France` → French Pimcore
   - `GER` → German Pimcore
   - `SAP` is intentionally **not** a project indicator (it's cross-cutting)
4. PM items always start Unassigned. The Productive service suffix may be
   surfaced as a hint, but the reviewer does the assignment.

Multiple matches → all pre-selected, reviewer confirms.
Missing JIRA estimate → rendered blank on both sides.

## Re-runs and corrections

- **Forgotten key**: add the missing key to the step-3 pull, re-run step 4.
  `build-report.js` warns on any key seen in Productive but not in the
  JIRA dump.
- **Wrong period**: adjust dates, rerun steps 1–4. Uploading the new JSON
  to an existing `draft` or `sent` report replaces it.
- **Mid-review corrections**: can't re-upload an `under_review` or
  `approved` report. Reopen it to `draft` from the admin UI first.

## Edge cases worth knowing

- **Entry with no JIRA key and no usable note** falls into a
  `(person, service)` bucket — rare in practice. Shows up as an Unassigned
  PM item the reviewer can merge or reassign.
- **Typo in a JIRA key** (`PCM-272` instead of `PCM2-272`): step 3 omits
  it, step 4 warns and writes a minimal fallback record. Either fix
  upstream in Productive and rerun, or let the reviewer reassign.
- **Budget names with `&`**: must be quoted when passed to the shell.
