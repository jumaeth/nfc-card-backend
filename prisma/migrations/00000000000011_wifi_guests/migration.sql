-- Guests who asked for the Wi-Fi password on a WIFI page with guest access on.

-- CreateTable
CREATE TABLE "WifiGuest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'de',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
    "consentAt" TIMESTAMP(3),
    "codeHash" TEXT,
    "codeExpiresAt" TIMESTAMP(3),
    "codeSentAt" TIMESTAMP(3),
    "codeAttempts" INTEGER NOT NULL DEFAULT 0,
    "visits" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WifiGuest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WifiGuest_companyId_lastSeenAt_idx" ON "WifiGuest"("companyId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "WifiGuest_pageId_email_key" ON "WifiGuest"("pageId", "email");

-- AddForeignKey
ALTER TABLE "WifiGuest" ADD CONSTRAINT "WifiGuest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WifiGuest" ADD CONSTRAINT "WifiGuest_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Tenant isolation, same policy as the other company-scoped tables. The public
-- Wi-Fi flow writes through the raw (owner) client, scoped by page slug.
ALTER TABLE "WifiGuest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WifiGuest" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WifiGuest"
  USING (app_can_access_company("companyId"))
  WITH CHECK (app_can_access_company("companyId"));
