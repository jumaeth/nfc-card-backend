-- Staff claim shop orders in the admin console. The claimer fulfils the order
-- and becomes the sales rep of the order's business.
ALTER TABLE "Order" ADD COLUMN "handledById" TEXT;
ALTER TABLE "Order" ADD COLUMN "handledAt" TIMESTAMP(3);

CREATE INDEX "Order_handledById_idx" ON "Order"("handledById");

ALTER TABLE "Order" ADD CONSTRAINT "Order_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
