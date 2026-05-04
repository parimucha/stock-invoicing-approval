-- Insert the new German Pimcore project; do nothing if it's already there.
INSERT INTO "Project" ("id", "name", "sortOrder")
VALUES ('german_pimcore', 'German Pimcore', 3)
ON CONFLICT ("id") DO NOTHING;

-- Slot SAP Spirit after the three Pimcores so the review page groups them.
UPDATE "Project" SET "sortOrder" = 4 WHERE "id" = 'sap_spirit';
