-- Physical card catalogue with stock, managed from the admin console and read
-- by the marketing site. Global table like SubscriptionPlan: no RLS.
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "stock" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Product_stock_check" CHECK ("stock" IS NULL OR "stock" >= 0),
    CONSTRAINT "Product_priceCents_check" CHECK ("priceCents" >= 0)
);

CREATE UNIQUE INDEX "Product_key_key" ON "Product"("key");

-- Current website prices, unlimited stock until set in the admin console.
INSERT INTO "Product" ("id", "key", "name", "priceCents", "stock", "active", "updatedAt") VALUES
    ('prod_business', 'business', 'Metal business card', 8900, NULL, true, CURRENT_TIMESTAMP),
    ('prod_review', 'review', 'Review & menu card', 5000, NULL, true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
