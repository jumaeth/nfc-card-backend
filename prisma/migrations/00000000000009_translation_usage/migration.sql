-- Auto-translate usage per page per month (limits Claude spend per company).

-- CreateTable
CREATE TABLE "TranslationUsage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranslationUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TranslationUsage_companyId_month_idx" ON "TranslationUsage"("companyId", "month");

-- CreateIndex
CREATE INDEX "TranslationUsage_pageId_idx" ON "TranslationUsage"("pageId");

-- CreateIndex
CREATE UNIQUE INDEX "TranslationUsage_companyId_pageId_month_key" ON "TranslationUsage"("companyId", "pageId", "month");

-- AddForeignKey
ALTER TABLE "TranslationUsage" ADD CONSTRAINT "TranslationUsage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranslationUsage" ADD CONSTRAINT "TranslationUsage_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Tenant isolation, same policy as the other company-scoped tables.
ALTER TABLE "TranslationUsage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TranslationUsage" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TranslationUsage"
  USING (app_can_access_company("companyId"))
  WITH CHECK (app_can_access_company("companyId"));
