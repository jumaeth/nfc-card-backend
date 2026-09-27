-- Reusable page designs per company.

-- CreateTable
CREATE TABLE "DesignTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "theme" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DesignTemplate_companyId_idx" ON "DesignTemplate"("companyId");

-- AddForeignKey
ALTER TABLE "DesignTemplate" ADD CONSTRAINT "DesignTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Tenant isolation, same policy as the other company-scoped tables.
ALTER TABLE "DesignTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DesignTemplate" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DesignTemplate"
  USING (app_can_access_company("companyId"))
  WITH CHECK (app_can_access_company("companyId"));
