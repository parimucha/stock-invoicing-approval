# Stock invoicing approval

A small internal web app that replaces the manual monthly Excel dance between
PORTA (the agency) and Stock (the client) for approving billable work before
invoicing. Everything that used to be copy-paste across spreadsheets now lives
in one report that Stock reviews through a magic link and signs off.

## What it does

1. **Once a month**, PORTA runs a local ingestion pipeline (this repo, Claude
   Code + Atlassian MCP + the Productive REST API) that pulls every time
   entry for Stock's monthly budget, joins it with the matching JIRA
   metadata, and emits a single `report.json`.
2. PORTA uploads that JSON to the hosted web app (`web/`), reviews it,
   optionally merges or renames PM items, writes notes for the client, and
   sends Stock a magic link.
3. Stock opens the link, walks through every item, approves / rejects, moves
   items between projects, leaves comments, and signs the report off.
4. PORTA invoices from the approved per-project totals.

## Shape of the thing

```
┌──────────────────────┐   JSON file   ┌────────────────────┐   magic link   ┌────────────────────┐
│ Local ingest         │ ───────────▶  │ Hosted web app     │ ─────────────▶ │ Stock reviewer     │
│ (scripts/ + MCP)     │               │ (web/, Vercel)     │                │ (browser, no auth) │
│                      │               │                    │                │                    │
│ - Productive API     │               │ - PORTA admin      │                │ - Review items     │
│ - Atlassian MCP      │               │   (password)       │                │ - Reassign project │
│ - Project mapping    │               │ - Upload JSON      │                │ - Approve / reject │
│ - Emit report.json   │               │ - Edit items       │                │ - Sign off         │
└──────────────────────┘               └────────────────────┘                └────────────────────┘
```

Two pieces, one contract: the `report.json` file. The hosted app has no
outbound access to JIRA or Productive — all reads happen locally during
ingestion, once a month.

## Quick start

```bash
# 1. Bring up the local Postgres
docker compose up -d

# 2. Install + set env
cd web
cp .env.example .env   # fill ADMIN_PASSWORD and SESSION_SECRET
npm install

# 3. Apply migrations + seed the three fixed projects
npx prisma migrate deploy
npm run db:seed

# 4. Run the app
npm run dev            # http://localhost:3000
```

For the monthly ingestion runbook, see [`scripts/README.md`](scripts/README.md).

## Documentation

- [Architecture](docs/architecture.md) — the two-piece design and why.
- [Data model](docs/data-model.md) — Prisma schema and report lifecycle.
- [Ingestion pipeline](docs/ingestion.md) — local monthly process.
- [PORTA admin guide](docs/admin-guide.md) — upload, edit, send, reopen, reset.
- [Stock review guide](docs/review-guide.md) — what the client sees, how to review.
- [Development](docs/development.md) — local setup, commands, project layout.
- [Deployment](docs/deployment.md) — Vercel + Postgres + migrations.
- [`PLAN.md`](PLAN.md) — original design doc; kept for historical context.

## Repository layout

```
proficio-mcp/
├── README.md                  ← you are here
├── PLAN.md                    original design doc
├── docker-compose.yml         local Postgres
├── docs/                      documentation pages
├── scripts/                   monthly ingestion pipeline
│   ├── README.md              ingestion runbook
│   ├── pull-productive-entries.js
│   └── build-report.js
├── data/<YYYY-MM>/            per-month raw dumps + final report.json (gitignored)
└── web/                       Next.js + Prisma app deployed to Vercel
    ├── prisma/
    ├── src/app/admin/         PORTA routes
    ├── src/app/client/[token]/ Stock dashboard listing all reports
    ├── src/app/review/[token]/ Stock per-report review routes
    └── src/components/        shared UI (BudgetBar, JiraLink, HelpButton, …)
```

## Tech stack

- **Next.js 16** (App Router, RSC, server actions)
- **Prisma 6** + **Postgres** (Vercel Postgres in prod, Docker locally)
- **Tailwind CSS 4**
- **TypeScript** strict
- **Vercel** for hosting; migrations run during `build`.

## License

Internal project — no license. PORTA source.
