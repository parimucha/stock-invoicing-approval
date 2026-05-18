# Deployment

Hosting is Vercel with Vercel Postgres. This doc covers the setup and what
happens on every push to `main`.

## One-time setup

1. Create a new Vercel project pointing at this repo. Set the **Root
   Directory** to `web/`. Framework preset: Next.js (pinned in
   `web/vercel.json`).
2. Add a **Vercel Postgres** integration from the project's Storage tab.
   Vercel injects:
   - `POSTGRES_URL` / `POSTGRES_PRISMA_URL` (pooled)
   - `POSTGRES_URL_NON_POOLING` (direct)
3. Map those to Prisma's expected names in **Project Settings → Environment
   Variables**:
   - `DATABASE_URL` = `POSTGRES_PRISMA_URL`
   - `DIRECT_URL` = `POSTGRES_URL_NON_POOLING`
4. Set the remaining app env vars:
   - `ADMIN_PASSWORD` — long, not reused anywhere else.
   - `SESSION_SECRET` — `openssl rand -hex 32` is fine.
   - `JIRA_BASE_URL` (optional) — e.g. `https://your-org.atlassian.net`.
   - `PRODUCTIVE_API_TOKEN`, `PRODUCTIVE_ORG_ID`, `PRODUCTIVE_STOCK_COMPANY_ID`
     (optional) — required only by the "Refresh lifetime totals" button on
     the admin report page. Without them the button is still visible but
     surfaces a config error when clicked. Same values as the local `.env`.
   - `JIRA_API_EMAIL`, `JIRA_API_TOKEN` (optional) — required only by the
     "Refresh JIRA statuses" button on the admin report page. Pair with
     `JIRA_BASE_URL`; the token is an Atlassian API token from
     <https://id.atlassian.com/manage-profile/security/api-tokens>. Without
     them the button surfaces a config error when clicked.
5. Trigger a deploy. The first build runs `prisma migrate deploy` against
   the pooled URL, which creates the schema.
6. Run the seed once (one-off, from your machine):
   ```bash
   DATABASE_URL="<POSTGRES_PRISMA_URL>" DIRECT_URL="<POSTGRES_URL_NON_POOLING>" \
     npm --prefix web run db:seed
   ```
   Seeds the three fixed projects.

## How migrations ship

`web/package.json`:

```json
"scripts": {
  "build": "prisma migrate deploy && next build",
  ...
}
```

Every Vercel build:

1. `prisma generate` (via `postinstall`) refreshes the Prisma client.
2. `prisma migrate deploy` applies any unapplied migrations in
   `prisma/migrations/` to the production DB.
3. `next build` compiles the app.

If `migrate deploy` fails, the build fails and the deploy is rejected —
the app stays on the previous version. For multi-statement migrations
wrap them in a transaction in the `.sql` file so you don't end up
partially migrated.

## Adding a new migration

See [development.md](development.md#creating-a-migration). Short version:

```bash
cd web
# edit prisma/schema.prisma
npx prisma migrate dev --name <slug>
git add prisma/schema.prisma prisma/migrations/<ts>_<slug>
git commit -m "..." && git push
```

The migration lands on Vercel with the next deploy.

## Domain

In the plan this was targeted at `profi.ci` on Cloudways. Production
actually runs on Vercel. Add a custom domain under **Project Settings →
Domains** and point DNS at Vercel. HSTS is applied automatically.

## Observability

- Runtime logs: Vercel dashboard → Project → Logs.
- Performance: `@vercel/speed-insights` is wired in via
  `web/src/app/layout.tsx`. Web Vitals land on the project's Speed
  Insights page.
- Errors in server actions bubble up to the client as error messages —
  keep messages informative without leaking internals (they're thrown
  to an authenticated admin in most paths).

## Rollback

Vercel keeps every deploy. To roll back:

1. Project → Deployments → pick a prior green deploy → **Promote to
   Production**.
2. If the rollback crosses a migration (you shipped a schema change and
   need to undo it), you'll also need to author and deploy a follow-up
   "down" migration. Prisma doesn't roll migrations back automatically.

## Security posture in production

- Sessions cookies are `httpOnly`, `sameSite=lax`, `secure` (in
  `NODE_ENV=production`).
- Admin actions all gate on `requireAdmin()`.
- `DATABASE_URL` is never read client-side.
- The JIRA base URL is the only env read at the edge; it's not a secret.

See [architecture.md](architecture.md#security-posture) for the full list.
