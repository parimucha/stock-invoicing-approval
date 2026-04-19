# Architecture

Two pieces, loosely coupled, one contract.

## The two pieces

### 1. Local ingestion (`scripts/`)

Runs on a developer machine once a month. Has full access to Productive
and JIRA credentials. Produces a single `report.json` file.

Why local:
- Credentials (Productive API token, JIRA access via MCP) never touch the
  hosted app.
- JIRA metadata pulls use Claude Code with the Atlassian MCP server — an
  interactive, approval-driven session, not an automated cron.
- Monthly cadence: not worth paying for a persistent worker.

### 2. Hosted web app (`web/`)

Next.js 16 App Router app deployed on Vercel, backed by Vercel Postgres.
Has no outbound access to Productive or JIRA. Stores the uploaded report,
handles the review flow, serves the magic link.

Why hosted:
- The reviewer (Stock) needs a stable URL with no install or account.
- The approval history has to persist and be auditable.

## The contract between them

A single JSON file: `data/<YYYY-MM>/report.json`. The schema is enforced on
upload by [`web/src/lib/report-schema.ts`](../web/src/lib/report-schema.ts).
One shape, validated on upload, no other wire format between the pieces.

## Why this split

The original plan ([`PLAN.md`](../PLAN.md)) had one constraint: "no live API
calls from the hosted app." Everything else followed:

- Monthly JSON handoff keeps the hosted app free of third-party secrets.
- Re-ingest + re-upload replaces drafts, so mid-month reruns are cheap.
- The hosted app stays a plain CRUD-ish UI that anyone on the team can
  reason about without needing to understand JIRA or Productive APIs.

## Data flow

```
Productive time entries ─┐
                         ├─▶ report.json  ─▶ upload  ─▶ DB  ─▶ review UI  ─▶ sign-off
JIRA metadata ───────────┘                         (admin edits layer on top)
```

Every step is idempotent:

- Re-running ingestion with the same inputs produces the same JSON.
- Re-uploading a JSON for an existing `draft` / `sent` report replaces it;
  `under_review` / `approved` are blocked (see `admin/upload/page.tsx`).
- The admin "Reset report" button restores ingest-time state, preserving
  admin edits (PORTA notes, summary renames, merges).

## Tech stack (and why)

| Concern       | Choice                | Why                                              |
|---------------|-----------------------|--------------------------------------------------|
| Framework     | Next.js 16 App Router | Server actions + RSC keep the app close to "forms that post"; low client JS surface. |
| DB            | Postgres via Prisma   | Typed schema, cheap migrations, maps cleanly onto the data model in `PLAN.md`. |
| Styling       | Tailwind 4            | No design system overhead; scales to "a few pages." |
| Ingestion     | Plain Node scripts    | No build step, easy to run ad hoc, easy to audit. |
| JIRA access   | Atlassian MCP         | Interactive, no standalone API token; batched JQL via Claude Code. |
| Productive    | Raw REST API          | The MCP wrapper strips JIRA integration fields we need. |
| Auth (PORTA)  | Password + cookie     | Single admin user; HMAC-signed cookie with `timingSafeEqual` checks. |
| Auth (Stock)  | Opaque magic token    | One reviewer per report, no accounts, shareable link. |
| Hosting       | Vercel                | Free tier for this scale; Postgres add-on; push-to-deploy. |

## Security posture

- Admin password compared with `timingSafeEqual`; session cookie HMAC-signed
  with `SESSION_SECRET`, 30-day expiry. See [`web/src/lib/auth.ts`](../web/src/lib/auth.ts).
- Every admin server action starts with `await requireAdmin()`. Not just the
  layout gate — each action rechecks.
- Magic tokens: 24 random bytes, base64url-encoded (192 bits of entropy).
- Review server actions authenticate via token-in-FormData (treated as
  bearer). The token is never logged or returned in errors.

## Performance posture

- Prisma client is a global singleton
  ([`web/src/lib/prisma.ts`](../web/src/lib/prisma.ts)).
- Review invoice overview is computed on the client from hoisted assignment
  state — no server round-trip on per-item autosave.
- Autosave server actions do not call `revalidatePath`; status-changing
  actions (sign-off, reopen) do.
- Scroll anchoring is disabled on the review page so the sticky invoice
  overview can change size cleanly.

For the concrete tables, see [data-model.md](data-model.md).
