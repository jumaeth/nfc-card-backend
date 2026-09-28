-- Plan prices are found in Stripe by lookup key (taplino_<tier>_<interval>).

-- AlterTable
ALTER TABLE "SubscriptionPlan" DROP COLUMN "stripePriceId";
