-- Soft delete for cards, pages, locations and company memberships. Rows are
-- flagged instead of removed so history (taps, audit) stays intact.
ALTER TABLE "Location" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Page" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Card" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "CompanyMember" ADD COLUMN "removedAt" TIMESTAMP(3);

CREATE INDEX "Location_companyId_deletedAt_idx" ON "Location"("companyId", "deletedAt");
CREATE INDEX "Page_companyId_deletedAt_idx" ON "Page"("companyId", "deletedAt");
CREATE INDEX "Card_companyId_deletedAt_idx" ON "Card"("companyId", "deletedAt");
CREATE INDEX "CompanyMember_companyId_removedAt_idx" ON "CompanyMember"("companyId", "removedAt");

-- A removed member used to lose their row, and with it RLS access. Keep that
-- guarantee now that the row stays.
CREATE OR REPLACE FUNCTION app_accessible_company_ids()
RETURNS TABLE (company_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cm."companyId"
  FROM "CompanyMember" cm
  WHERE cm."userId" = NULLIF(current_setting('app.current_user_id', true), '')
    AND cm."removedAt" IS NULL;
$$;
