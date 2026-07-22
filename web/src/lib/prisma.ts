import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  warnIfRemoteDatabase();
}

// Local dev belongs on the Docker Postgres in docker-compose.yml. Pointing it
// at Neon instead is expensive in a way that isn't visible while you work: the
// dev server holds a Prisma pool open, that resets Neon's scale-to-zero timer
// on every request, and the compute bills 0.25 CU-hr per wall-clock hour for as
// long as the process lives — ~6 CU-hrs/day against a 100 CU-hr monthly plan.
// The Vercel-pulled env files are named .env.vercel* so Next won't auto-load
// them; this catches the case where one gets restored to .env*.local.
function warnIfRemoteDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) return;

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return;
  }

  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    console.info(`[prisma] local database: ${host}`);
    return;
  }

  console.warn(
    `[prisma] WARNING: dev is connected to a REMOTE database (${host}).\n` +
      `[prisma] This keeps the compute awake and burns compute hours for as ` +
      `long as this process runs.\n` +
      `[prisma] Expected the local Docker Postgres — check for a .env.local / ` +
      `.env.development.local overriding DATABASE_URL in .env.`,
  );
}
