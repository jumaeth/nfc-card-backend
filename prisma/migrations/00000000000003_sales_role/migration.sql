-- Sales staff role + customer ownership for the admin console.
ALTER TYPE "PlatformRole" ADD VALUE IF NOT EXISTS 'SALES' BEFORE 'SUPPORT';

ALTER TABLE "Company" ADD COLUMN "salesRepId" TEXT;

CREATE INDEX "Company_salesRepId_idx" ON "Company"("salesRepId");

ALTER TABLE "Company" ADD CONSTRAINT "Company_salesRepId_fkey"
  FOREIGN KEY ("salesRepId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
