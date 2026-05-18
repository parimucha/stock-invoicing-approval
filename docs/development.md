# Development

Local setup, commands, and project layout.

## Prerequisites

- Node 20+
- Docker (for the local Postgres container)
- A Claude Code session with the Atlassian MCP if you're going to run the
  ingestion pipeline (otherwise just the app works fine without it)

## First-time setup

```bash
# 1. Start the local Postgres on port 5433
docker compose up -d

# 2. Install + configure the web app
cd web
cp .env.example .env
# fill in ADMIN_PASSWORD and SESSION_SECRET; leave the rest at defaults
npm install

# 3. Apply migrations and seed the three fixed projects
npx prisma migrate deploy
npm run db:seed

# 4. Run the dev server
npm run dev
# http://localhost:3000 → /login
```

The `postinstall` hook runs `prisma generate` so the Prisma client is
always in sync with `schema.prisma`.

## Environment variables

From `web/.env.example`:

| var                | where used                   | notes                                       |
|--------------------|------------------------------|---------------------------------------------|
| `DATABASE_URL`     | Prisma                       | Postgres connection string                  |
| `DIRECT_URL`       | Prisma (migrations)          | Same as DATABASE_URL when using plain Postgres. Vercel Postgres needs a separate direct URL to bypass the connection pooler during migrations. |
| `ADMIN_PASSWORD`   | `signInAdmin`                | PORTA admin password                        |
| `SESSION_SECRET`   | `signInAdmin` / `isAdmin`    | HMAC-SHA256 key for the session cookie. Any long random string. |
| `JIRA_BASE_URL`    | `JiraLink` rendering + REST  | Optional. e.g. `https://your-org.atlassian.net`. Links JIRA keys in the UI, and base for the "Refresh JIRA statuses" admin button (which routes through `api.atlassian.com/ex/jira/{cloudId}/…`). |
| `JIRA_API_EMAIL`   | Refresh JIRA statuses        | Optional. Atlassian account email paired with the API token. |
| `JIRA_API_TOKEN`   | Refresh JIRA statuses        | Optional. Atlassian API token (from <https://id.atlassian.com/manage-profile/security/api-tokens>). Scoped tokens are fine; needs `read:jira-work` + `read:issue:jira`. |
| `PRODUCTIVE_API_TOKEN` | Refresh lifetime totals  | Optional. Same value as the ingestion `.env`. |
| `PRODUCTIVE_ORG_ID`    | Refresh lifetime totals  | Optional. Same value as the ingestion `.env`. |
| `PRODUCTIVE_STOCK_COMPANY_ID` | Refresh lifetime totals | Optional. Stock's company id in Productive. |

For ingestion scripts (root-level `.env`):

| var                          | notes                                  |
|------------------------------|----------------------------------------|
| `PRODUCTIVE_API_TOKEN`       | Productive REST API token              |
| `PRODUCTIVE_ORG_ID`          | Productive organization id             |
| `PRODUCTIVE_STOCK_COMPANY_ID`| Used by `pull-productive-totals.js`    |

## Local debugging against the production database

For chasing prod-only bugs without re-creating data on a local DB:

```bash
cd web
vercel env pull .env.local --environment=production
npm run dev
```

Next.js loads `.env.local` ahead of `.env`, so `DATABASE_URL`, magic
tokens, and admin password become the production values. Useful for
reproducing bugs that depend on real reports or for verifying server
actions before pushing. Any write you make in the UI hits prod — treat
every Save / Mark / Refresh button as a real production write. Delete
`web/.env.local` when you're done.

The `scripts/check-jira-api.js` standalone smoke test reuses the same
env to verify the "Refresh JIRA statuses" path end-to-end without
booting Next.

## Useful commands

From `web/`:

```bash
npm run dev                 # Next.js dev server
npm run build               # runs prisma migrate deploy, then next build
npm run lint                # eslint

npx prisma migrate dev --name <name>   # create + apply a new migration
npx prisma migrate deploy   # apply pending migrations
npx prisma studio           # poke at the DB in a GUI
npm run db:seed             # seed the three projects
```

## Creating a migration

```bash
cd web
# edit prisma/schema.prisma
npx prisma migrate dev --name short_slug
```

Commit `prisma/schema.prisma` plus the generated
`prisma/migrations/<ts>_<short_slug>/migration.sql`. Vercel runs
`prisma migrate deploy` automatically on the next build, so the
production DB is updated on deploy — no manual step needed.

See [deployment.md](deployment.md) for details.

## Project layout (web/)

```
web/
├── prisma/
│   ├── schema.prisma
│   ├── seed.ts
│   └── migrations/
├── src/
│   ├── app/
│   │   ├── layout.tsx          root layout, light-mode html
│   │   ├── page.tsx            landing → /admin
│   │   ├── globals.css
│   │   ├── login/
│   │   ├── admin/
│   │   │   ├── layout.tsx      requireAdmin gate
│   │   │   ├── page.tsx        reports list
│   │   │   ├── upload/
│   │   │   └── reports/[id]/
│   │   │       ├── page.tsx
│   │   │       ├── actions.ts  merge / notes / internal / summary / reset
│   │   │       └── AdminItemsTable.tsx
│   │   └── review/[token]/
│   │       ├── page.tsx        magic-link landing
│   │       ├── actions.ts      saveItem / signOff / reopenReview
│   │       ├── ReviewItems.tsx client wrapper with filter/sort + invoice overview
│   │       └── ItemCard.tsx
│   ├── components/
│   │   ├── ApprovalBreakdownBar.tsx  stacked bar of approved/pending/rejected/internal
│   │   ├── BudgetBar.tsx
│   │   ├── ConfirmForm.tsx
│   │   ├── HelpButton.tsx
│   │   ├── ItemBreakdownCard.tsx     shared pending/rejected detail card
│   │   ├── JiraLink.tsx
│   │   ├── JiraStatusBadge.tsx       shared status pill used on both sides
│   │   ├── PendingButton.tsx
│   │   └── PmShareIndicator.tsx
│   └── lib/
│       ├── prisma.ts           singleton client
│       ├── auth.ts             cookie + requireAdmin + magic token
│       ├── jira.ts             base URL + REST client (cloudId-routed)
│       ├── productive.ts       REST client for lifetime totals refresh
│       ├── format.ts           minutes/seconds → hours formatting
│       └── report-schema.ts    JSON upload validator
├── next.config.ts
├── package.json
└── vercel.json
```

## Conventions

- Server actions live alongside the route that owns them (e.g.
  `admin/reports/[id]/actions.ts`). Each admin action starts with
  `await requireAdmin()`.
- Shared UI goes under `src/components/`. Everything non-trivial that's
  reused across routes.
- Prisma is reached only through the singleton in `src/lib/prisma.ts`.
- Prefer server components; reach for `"use client"` only when there's
  state or an event handler that actually needs the client.

## Testing

There's no test suite. Changes are verified by running the app against a
seeded local DB and exercising the flow. For UI-affecting changes on a
real month's data, reset the report with the admin "Reset report" button
after each run.

## Local dev gotcha: tailwindcss / speed-insights resolve errors

When the repo root has its own `package.json` + `node_modules` (the MCP
server lives there), Next 16 / Turbopack and Tailwind v4 mis-infer the
workspace root and walk up from `web/` into the parent's `node_modules`
— where neither `tailwindcss` nor `@vercel/speed-insights/next` exist.
Workarounds already wired in:

- Root `package.json` has `tailwindcss` as a devDep, so the package is
  resolvable from the parent dir.
- `web/postcss.config.mjs` pins `base` to `web/` explicitly.
- `web/src/app/globals.css` uses `@import "tailwindcss" source("../..")`
  to pin Tailwind v4's class scanner to `web/`.
- `web/src/app/layout.tsx` loads `@vercel/speed-insights/next` via a
  dynamic import gated on `process.env.VERCEL`, so locally it's never
  required.
- `web/next.config.ts` pins `turbopack.root` to `web/` (via
  `import.meta.url`). Do **not** also set `outputFileTracingRoot` — that
  breaks the Vercel build adapter.
