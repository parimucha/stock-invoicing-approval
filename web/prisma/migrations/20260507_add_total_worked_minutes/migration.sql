-- Lifetime worked minutes on the JIRA key (across all of Stock's deals/months).
-- Nullable: only populated for JIRA-linked items, and only when the ingest
-- pipeline has access to the lifetime totals dump. PM items and any
-- pre-existing rows stay NULL.
ALTER TABLE "ReportItem" ADD COLUMN "totalWorkedMinutes" INTEGER;
