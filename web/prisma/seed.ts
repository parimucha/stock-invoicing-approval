import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const projects = [
  { id: "czech_pimcore", name: "Czech Pimcore", sortOrder: 1 },
  { id: "french_pimcore", name: "French Pimcore", sortOrder: 2 },
  { id: "german_pimcore", name: "German Pimcore", sortOrder: 3 },
  { id: "sap_spirit", name: "SAP Spirit", sortOrder: 4 },
];

async function main() {
  for (const p of projects) {
    await prisma.project.upsert({
      where: { id: p.id },
      update: { name: p.name, sortOrder: p.sortOrder },
      create: p,
    });
  }
  console.log(`Seeded ${projects.length} projects.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
