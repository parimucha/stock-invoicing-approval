-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('draft', 'sent', 'under_review', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "ItemSource" AS ENUM ('jira', 'project_management');

-- CreateEnum
CREATE TYPE "Approval" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "productiveDealId" TEXT,
    "productiveBudgetName" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'draft',
    "magicToken" TEXT NOT NULL,
    "reviewerNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportItem" (
    "id" SERIAL NOT NULL,
    "reportId" INTEGER NOT NULL,
    "source" "ItemSource" NOT NULL,
    "jiraKey" TEXT,
    "summary" TEXT NOT NULL,
    "workedMinutes" INTEGER NOT NULL,
    "estimatedSeconds" INTEGER,
    "jiraIssuetype" TEXT,
    "jiraStatus" TEXT,
    "jiraLabels" JSONB NOT NULL,
    "parentKey" TEXT,
    "parentSummary" TEXT,
    "pmNotes" TEXT,
    "suggestedProjects" JSONB NOT NULL,
    "approval" "Approval" NOT NULL DEFAULT 'pending',
    "reviewerComment" TEXT,

    CONSTRAINT "ReportItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectAssignment" (
    "itemId" INTEGER NOT NULL,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "ProjectAssignment_pkey" PRIMARY KEY ("itemId","projectId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_name_key" ON "Project"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Report_label_key" ON "Report"("label");

-- CreateIndex
CREATE UNIQUE INDEX "Report_magicToken_key" ON "Report"("magicToken");

-- CreateIndex
CREATE INDEX "ReportItem_reportId_idx" ON "ReportItem"("reportId");

-- CreateIndex
CREATE INDEX "ProjectAssignment_projectId_idx" ON "ProjectAssignment"("projectId");

-- AddForeignKey
ALTER TABLE "ReportItem" ADD CONSTRAINT "ReportItem_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAssignment" ADD CONSTRAINT "ProjectAssignment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ReportItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAssignment" ADD CONSTRAINT "ProjectAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
