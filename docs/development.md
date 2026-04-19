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
| `JIRA_BASE_URL`    | `JiraLink` rendering         | Optional. e.g. `https://your-org.atlassian.net`. When set, JIRA keys in the UI become clickable links. |

For ingestion scripts (root-level `.env`):

| var                   | notes                                |
|-----------------------|--------------------------------------|
| `PRODUCTIVE_API_TOKEN`| Productive REST API token            |
| `PRODUCTIVE_ORG_ID`   | Productive organization id           |

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
│   │   ├── BudgetBar.tsx
│   │   ├── JiraLink.tsx
│   │   ├── HelpButton.tsx
│   │   ├── ConfirmForm.tsx
│   │   ├── PendingButton.tsx
│   │   └── PmShareIndicator.tsx
│   └── lib/
│       ├── prisma.ts           singleton client
│       ├── auth.ts             cookie + requireAdmin + magic token
│       ├── jira.ts             base URL helpers
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
