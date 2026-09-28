-- Self-serve plan subscriptions through Stripe Billing.

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "cancelAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");
