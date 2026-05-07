# Monthly ingestion runbook

End-to-end procedure for generating the `report.json` uploaded to the web app.
Runs **locally**, once per month, using this repo plus Claude Code + Atlassian MCP.

## Prerequisites

1. `.env` at repo root with:
   ```
   PRODUCTIVE_API_TOKEN=...
   PRODUCTIVE_ORG_ID=...
   PRODUCTIVE_STOCK_COMPANY_ID=1055199   # used by step 4 (lifetime totals)
   ```
2. Claude Code with the **Atlassian MCP** connected (for JIRA metadata).
3. Node 20+ (scripts are plain CommonJS, no install step).

## Inputs you need each month

- **Productive deal ID** for the stock.cz monthly budget — e.g. `3624023` for `stock.cz_design&development (2026/03)`. Find it in Productive (Budgets → open the month → URL or deal picker).
- **Period** — `YYYY-MM-01` through the last day of the month.
- **Budget name** — purely for audit on the report (`stock.cz_design&development (2026/MM)`).

## Steps

### 1. Pull Productive time entries

```bash
mkdir -p data/<YYYY-MM>/raw
node scripts/pull-productive-entries.js <dealId> <YYYY-MM-01> <YYYY-MM-LL> data/<YYYY-MM>/raw/productive-entries.json
```

This paginates through every time entry on the deal in that window, flattens
relationships, and resolves each entry's JIRA key from the native
`jira_issue_id` field, falling back to a regex over the note text. Each entry
carries a `jira_key_source` tag (`productive_field` / `note_regex`) so the
recovery path is auditable.

Sanity check: the script prints `Wrote N entries` — eyeball against expected
volume. For March 2026 it was 169.

### 2. Collect the distinct JIRA keys

```bash
node -e "const x=require('./data/<YYYY-MM>/raw/productive-entries.json'); const s=new Set(x.entries.map(e=>e.jira_key).filter(Boolean)); console.log([...s].sort().join('\n'))"
```

Save the list — you'll paste it into the JIRA pull.

### 3. Pull JIRA metadata via Claude Code + Atlassian MCP

Open Claude Code in this repo and run a prompt like:

> For each of these JIRA keys: `<paste sorted list>`, fetch from Atlassian MCP
> the `summary`, `status`, `issuetype`, `labels`, `parent.key`,
> `parent.fields.summary`, and `timeoriginalestimate`. Use batched JQL (`key in
> (K1, K2, …)`) in groups of ~10 keys. Write the result to
> `data/<YYYY-MM>/raw/jira-issues.json` in this exact shape:
>
> ```json
> {"issues":[
>   {"key":"...", "summary":"...", "status":"...", "issuetype":"...",
>    "labels":[...], "parent_key":"...", "parent_summary":"...",
>    "estimate_seconds": 14400}
> ]}
> ```
>
> `estimate_seconds` is `timeoriginalestimate` converted to seconds (or `null`
> if unset). Use `null` for any missing string field.

Batching keeps each MCP call responsive; `key in (...)` with ~10 keys per batch
is the tested sweet spot.

### 4. Pull lifetime totals per JIRA key (optional but recommended)

```bash
node scripts/pull-productive-totals.js data/<YYYY-MM>/raw/productive-totals.json
```

Pulls every Productive time entry for Stock's company (`PRODUCTIVE_STOCK_COMPANY_ID`,
no date filter), groups by JIRA key, and writes a `{ totals: { KEY: minutes } }`
JSON. This becomes the "h total" reference shown next to each JIRA item's
monthly worked time on the review page — useful for tickets that span more
than one invoiced month. You can override the company id by passing it
explicitly: `node scripts/pull-productive-totals.js 1055199 path/to/out.json`.

Skipping this step is fine — `build-report.js` warns and the report still
builds; the lifetime column just stays empty.

### 5. Build the upload-ready report

```bash
node scripts/build-report.js data/<YYYY-MM> <YYYY-MM-01> <YYYY-MM-LL> "stock.cz_design&development (YYYY/MM)"
```

Writes `data/<YYYY-MM>/report.json`. The script:

- Groups entries by `jira_key` (JIRA items) or by normalized Productive note
  (PM items — no JIRA link).
- Applies the project-mapping rules: `SAPS-*` → SAP Spirit - general (the
  four country-specific SAP Spirit variants are reviewer-only); parent
  `PCM2-91` → Czech Pimcore, `PCM2-92` → French Pimcore, `PCM2-229` →
  German Pimcore, `PCM2-187` → Slovak Pimcore; label `CZ` / `France` /
  `GER` / `SK` as a fallback. Other parents / labels (General, etc.) stay
  Unassigned.
- Sums worked minutes, emits `suggested_projects`, and sorts items by worked
  time descending.
- If `raw/productive-totals.json` exists (step 4), copies the lifetime
  minutes for each JIRA key into `total_worked_minutes` per item.

Warnings (`⚠ JIRA key XXX appears in Productive but wasn't pulled from JIRA`)
mean the key is missing from step 3 — re-run the JIRA pull and include it.

### 6. Upload

- Bring up the web app locally (or use the hosted one).
- Open `/admin/upload`, paste or attach `data/<YYYY-MM>/report.json`, submit.
- Copy the magic link from the report detail page, send to Stock.

## File layout per month

```
data/<YYYY-MM>/
  raw/
    productive-entries.json    # step 1
    jira-issues.json           # step 3
    productive-totals.json     # step 4 (optional: lifetime minutes per JIRA key)
  report.json                  # step 5, uploaded in step 6
```

Raw dumps stay on disk for audit; the upload only uses `report.json`.

## Known edge cases

- **Entry with no JIRA key and no note** falls into a `(person, service)`
  bucket — rare, but possible. Review shows up as an Unassigned PM item.
- **Key in the note but not a real JIRA issue** (typo) → step 3 will omit it;
  step 4 warns and uses a minimal fallback record. Fix in Productive and
  re-run, or leave and let Stock reassign manually.
- **Budget name with ampersand** must be quoted on the shell (`"… & …"`).
