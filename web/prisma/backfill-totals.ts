/**
 * Backfill ReportItem.totalWorkedMinutes from a productive-totals.json dump
 * without touching anything else on the report (no deletions, no status
 * changes, no edits to summary / approval / assignments / comments).
 *
 * Use this when you've already collected admin or reviewer edits on an
 * existing report but still want the lifetime "h total" reference filled in.
 * Idempotent — re-running with newer totals just overwrites the number.
 *
 * Usage:
 *   npx tsx prisma/backfill-totals.ts <totalsJsonPath> [--label <YYYY-MM>] [--dry-run]
 *
 * Examples:
 *   # Backfill every report (every status) from the freshest totals dump.
 *   npx tsx prisma/backfill-totals.ts ../data/2026-04/raw/productive-totals.json
 *
 *   # Scope to a single month and preview without writing.
 *   npx tsx prisma/backfill-totals.ts ../data/2026-04/raw/productive-totals.json --label 2026-03 --dry-run
 *
 * Environment:
 *   DATABASE_URL / DIRECT_URL — the script writes wherever Prisma is pointed.
 *   For prod, run `vercel env pull` first so you connect to the hosted DB.
 */

import * as fs from "node:fs";
import { PrismaClient } from "@prisma/client";

type Totals = { totals?: Record<string, number> };

function parseArgs(argv: string[]) {
  const rest: string[] = [];
  let label: string | null = null;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--label") {
      label = argv[++i] ?? null;
    } else if (a === "--dry-run") {
      dryRun = true;
    } else {
      rest.push(a);
    }
  }
  return { totalsPath: rest[0] ?? null, label, dryRun };
}

async function main() {
  const { totalsPath, label, dryRun } = parseArgs(process.argv.slice(2));
  if (!totalsPath) {
    console.error(
      "Usage: tsx prisma/backfill-totals.ts <totalsJsonPath> [--label <YYYY-MM>] [--dry-run]",
    );
    process.exit(1);
  }
  if (!fs.existsSync(totalsPath)) {
    throw new Error(`Totals file not found: ${totalsPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(totalsPath, "utf8")) as Totals;
  const totals = raw.totals ?? {};
  const keys = Object.keys(totals);
  if (keys.length === 0) {
    console.warn("Totals file has no entries — nothing to backfill.");
    return;
  }

  const prisma = new PrismaClient();
  try {
    let reportFilter: { reportId: number } | Record<string, never> = {};
    if (label) {
      const report = await prisma.report.findUnique({ where: { label } });
      if (!report) throw new Error(`No report with label "${label}".`);
      reportFilter = { reportId: report.id };
      console.log(`Scoped to report ${label} (id ${report.id}).`);
    }

    let updated = 0;
    let unchanged = 0;
    let missing = 0;

    for (const [jiraKey, minutes] of Object.entries(totals)) {
      const result = await prisma.reportItem.updateMany({
        where: {
          ...reportFilter,
          jiraKey,
          source: "jira",
          NOT: { totalWorkedMinutes: minutes },
        },
        data: dryRun ? {} : { totalWorkedMinutes: minutes },
      });
      if (result.count > 0) {
        updated += result.count;
        if (dryRun) {
          process.stdout.write(`would update ${result.count}× ${jiraKey} → ${minutes}m\n`);
        }
      } else {
        // Either no row carries this key (unrelated to the report) or the
        // value is already correct. Distinguish so the report makes sense.
        const present = await prisma.reportItem.count({
          where: { ...reportFilter, jiraKey, source: "jira" },
        });
        if (present === 0) missing += 1;
        else unchanged += present;
      }
    }

    const verb = dryRun ? "Would update" : "Updated";
    console.log(
      `${verb} ${updated} row(s); ${unchanged} already current; ` +
        `${missing} key(s) in totals had no matching JIRA item${label ? ` in ${label}` : ""}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
