-- One row per client tenant. magicToken backs the `/client/<token>`
-- dashboard. Reports aren't linked to a specific client yet; the dashboard
-- surfaces every non-draft report.
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "magicToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Client_name_key" ON "Client"("name");
CREATE UNIQUE INDEX "Client_magicToken_key" ON "Client"("magicToken");
