import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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
