-- Insert Slovak Pimcore alongside the other three; do nothing if already present.
INSERT INTO "Project" ("id", "name", "sortOrder")
VALUES ('slovak_pimcore', 'Slovak Pimcore', 4)
ON CONFLICT ("id") DO NOTHING;

-- Rename the existing SAP Spirit row to the new "general" variant and slot it
-- after the four Pimcores. The id stays the same so existing report items keep
-- their assignment.
UPDATE "Project"
SET "name" = 'SAP Spirit - general', "sortOrder" = 5
WHERE "id" = 'sap_spirit';

-- Add the four country-specific SAP Spirit variants. These are reviewer-only
-- buckets — ingestion still routes every SAPS-* ticket to "SAP Spirit - general".
INSERT INTO "Project" ("id", "name", "sortOrder") VALUES
  ('sap_spirit_cz', 'SAP Spirit - CZ', 6),
  ('sap_spirit_sk', 'SAP Spirit - SK', 7),
  ('sap_spirit_fr', 'SAP Spirit - FR', 8),
  ('sap_spirit_de', 'SAP Spirit - DE', 9)
ON CONFLICT ("id") DO NOTHING;
