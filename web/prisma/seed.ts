import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

const prisma = new PrismaClient();

// Single seeded client. magicToken is generated on first seed only and
// kept across re-seeds — the URL goes to the customer once, so we never
// want a re-run to invalidate it. To rotate, delete the row first.
const clients = [{ name: "Stock" }];

const projects = [
  { id: "czech_pimcore", name: "Czech Pimcore", sortOrder: 1 },
  { id: "french_pimcore", name: "French Pimcore", sortOrder: 2 },
  { id: "german_pimcore", name: "German Pimcore", sortOrder: 3 },
  { id: "slovak_pimcore", name: "Slovak Pimcore", sortOrder: 4 },
  { id: "sap_spirit", name: "SAP Spirit - general", sortOrder: 5 },
  { id: "sap_spirit_cz", name: "SAP Spirit - CZ", sortOrder: 6 },
  { id: "sap_spirit_sk", name: "SAP Spirit - SK", sortOrder: 7 },
  { id: "sap_spirit_fr", name: "SAP Spirit - FR", sortOrder: 8 },
  { id: "sap_spirit_de", name: "SAP Spirit - DE", sortOrder: 9 },
];

function newMagicToken(): string {
  return randomBytes(24).toString("base64url");
}

async function main() {
  for (const p of projects) {
    await prisma.project.upsert({
      where: { id: p.id },
      update: { name: p.name, sortOrder: p.sortOrder },
      create: p,
    });
  }
  console.log(`Seeded ${projects.length} projects.`);

  for (const c of clients) {
    const existing = await prisma.client.findUnique({ where: { name: c.name } });
    if (existing) {
      console.log(`Client "${c.name}" already exists; dashboard URL unchanged.`);
      continue;
    }
    const created = await prisma.client.create({
      data: { name: c.name, magicToken: newMagicToken() },
    });
    console.log(`Created client "${c.name}" with dashboard token: ${created.magicToken}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
