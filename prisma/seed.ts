import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

// Seeds the global subscription-plan catalogue. Mirrors the pricing on the
// marketing site (taplino.ch): Starter (per-card one-time), Pro (monthly),
// Managed (monthly, hands-off). Feature flags here drive plan gating in the API
// (see BillingService.getCompanyFeatures).
const PLANS = [
  {
    tier: 'STARTER' as const,
    name: 'Starter',
    priceCents: 5000, // CHF 50 one-time per card
    interval: 'ONE_TIME' as const,
    features: {
      analytics: false,
      multiLocation: false,
      maxLocations: 1,
      unlimitedDestinationChanges: false,
      managed: false,
    },
  },
  {
    tier: 'PRO' as const,
    name: 'Pro',
    priceCents: 3900, // CHF 39 / month
    interval: 'MONTHLY' as const,
    features: {
      analytics: true,
      multiLocation: true,
      maxLocations: 10,
      unlimitedDestinationChanges: true,
      managed: false,
    },
  },
  {
    tier: 'MANAGED' as const,
    name: 'Managed',
    priceCents: 25000, // CHF 250 / month
    interval: 'MONTHLY' as const,
    features: {
      analytics: true,
      multiLocation: true,
      maxLocations: null, // unlimited
      unlimitedDestinationChanges: true,
      managed: true,
    },
  },
];

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  for (const plan of PLANS) {
    await prisma.subscriptionPlan.upsert({
      where: { tier: plan.tier },
      create: plan,
      update: {
        name: plan.name,
        priceCents: plan.priceCents,
        interval: plan.interval,
        features: plan.features,
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log(`Seeded ${PLANS.length} subscription plans.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
