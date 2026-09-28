-- After a downgrade nothing is deleted: locations over the plan limit and pages
-- on a plan without them become read-only.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "pagesOverride" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN "readOnly" BOOLEAN NOT NULL DEFAULT false;
