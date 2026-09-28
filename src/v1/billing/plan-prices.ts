import type {
  BillingInterval,
  PlanTier,
} from '../../../generated/prisma/client.js';

// Stripe prices are found by lookup key, never by a stored id, so the same code
// and database work against the sandbox and live accounts. `pnpm stripe:plans`
// creates the prices; when a plan's price changes, the new price takes over the
// key and the old one is archived (existing subscribers stay on it).

/** e.g. taplino_pro_monthly */
export function planLookupKey(plan: {
  tier: PlanTier;
  interval: BillingInterval;
}): string {
  return `taplino_${plan.tier.toLowerCase()}_${plan.interval.toLowerCase()}`;
}

/** Stripe product id of a plan, e.g. taplino_plan_pro */
export function planProductId(plan: { tier: PlanTier }): string {
  return `taplino_plan_${plan.tier.toLowerCase()}`;
}
