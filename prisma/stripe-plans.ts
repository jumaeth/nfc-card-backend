import 'dotenv/config';
import Stripe from 'stripe';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { planLookupKey, planProductId } from '../src/v1/billing/plan-prices.js';

// Creates the Stripe products and prices for the paid subscription plans from
// the plans in the database. Safe to run again: products have fixed ids
// (taplino_plan_pro) and prices a lookup key (taplino_pro_monthly), so existing
// ones are reused. The API finds prices by that lookup key, so nothing is
// stored. When a plan's price changed, a new Stripe price takes over the lookup
// key and the old one is archived (current subscribers keep it).
//   pnpm stripe:plans              uses STRIPE_SECRET_KEY and DATABASE_URL
//   pnpm stripe:plans --dry-run    only prints what it would do
// Run it once per Stripe environment (sandbox, live) with that key, and again
// after changing a plan's price in the admin console.

const CURRENCY = 'chf';

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set.');
  const live = /^(sk|rk)_live_/.test(key);
  const stripe = new Stripe(key);

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const say = (msg: string) => console.log(msg);
  say(
    `Stripe ${live ? 'LIVE' : 'sandbox/test'} mode${dryRun ? ' (dry run)' : ''}`,
  );

  const plans = await prisma.subscriptionPlan.findMany({
    where: { interval: { in: ['MONTHLY', 'YEARLY'] }, priceCents: { gt: 0 } },
    orderBy: { priceCents: 'asc' },
  });

  for (const plan of plans) {
    const interval = plan.interval === 'YEARLY' ? 'year' : 'month';
    const productId = planProductId(plan);
    const lookupKey = planLookupKey(plan);
    const name = `Taplino ${plan.name}`;

    // Product
    let product: Stripe.Product | null = null;
    try {
      product = await stripe.products.retrieve(productId);
    } catch (err) {
      if (!(err instanceof Stripe.errors.StripeInvalidRequestError)) throw err;
    }
    if (!product) {
      say(`+ product ${productId} "${name}"`);
      if (!dryRun) {
        product = await stripe.products.create({
          id: productId,
          name,
          metadata: { tier: plan.tier },
        });
      }
    } else if (product.name !== name || !product.active) {
      say(`~ product ${productId} "${name}"`);
      if (!dryRun) {
        product = await stripe.products.update(productId, {
          name,
          active: true,
        });
      }
    }

    // Price
    const [existing] = (
      await stripe.prices.list({
        lookup_keys: [lookupKey],
        active: true,
        limit: 1,
      })
    ).data;
    const matches =
      existing &&
      existing.product === productId &&
      existing.currency === CURRENCY &&
      existing.unit_amount === plan.priceCents &&
      existing.recurring?.interval === interval;

    let priceId = matches ? existing.id : null;
    if (!matches) {
      say(
        `+ price ${lookupKey} CHF ${(plan.priceCents / 100).toFixed(2)} / ${interval}`,
      );
      if (!dryRun) {
        const price = await stripe.prices.create({
          product: productId,
          currency: CURRENCY,
          unit_amount: plan.priceCents,
          recurring: { interval },
          lookup_key: lookupKey,
          transfer_lookup_key: true,
          metadata: { tier: plan.tier },
        });
        priceId = price.id;
        await stripe.products.update(productId, { default_price: price.id });
        if (existing) {
          say(`- archive old price ${existing.id}`);
          await stripe.prices.update(existing.id, { active: false });
        }
      }
    }

    if (priceId) say(`= ${plan.name}: ${priceId} (${lookupKey})`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
