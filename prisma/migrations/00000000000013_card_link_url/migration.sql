-- A card can send taps straight to a custom link instead of a page.
ALTER TABLE "Card" ADD COLUMN "linkUrl" TEXT;
