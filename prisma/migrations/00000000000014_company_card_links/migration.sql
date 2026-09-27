-- Card links become /c/<company slug>/<card slug>: card slugs only need to be
-- unique within their company. Cards that exist now keep answering the old
-- /c/<slug> URL (their slugs were globally unique), so printed cards work.

-- AlterTable
ALTER TABLE "Card" ADD COLUMN "legacyPath" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Card" SET "legacyPath" = true;

-- DropIndex
DROP INDEX "Card_slug_key";

-- CreateIndex
CREATE UNIQUE INDEX "Card_companyId_slug_key" ON "Card"("companyId", "slug");

-- CreateIndex
CREATE INDEX "Card_slug_idx" ON "Card"("slug");

-- A company's earlier slugs keep resolving (printed cards carry them).
ALTER TABLE "Company" ADD COLUMN "previousSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[];
