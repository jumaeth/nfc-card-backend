import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { SubscriptionPlan } from '../../../generated/prisma/client.js';

/** Resolved feature set for a company, after applying its subscription plan. */
export interface CompanyFeatures {
  tier: string;
  analytics: boolean;
  multiLocation: boolean;
  /** null = unlimited. */
  maxLocations: number | null;
  unlimitedDestinationChanges: boolean;
  managed: boolean;
  /** Customer can create pages in the panel. Staff provision pages for plans without it. */
  createPages: boolean;
}

// Conservative defaults for a company with no resolvable plan (Starter tier).
const STARTER_FEATURES: CompanyFeatures = {
  tier: 'STARTER',
  analytics: false,
  multiLocation: false,
  maxLocations: 1,
  unlimitedDestinationChanges: false,
  managed: false,
  createPages: false,
};

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  /** The plan catalogue (public). Ordered cheapest first. */
  listPlans() {
    return this.prisma.subscriptionPlan.findMany({ orderBy: { priceCents: 'asc' } });
  }

  /** A company's current subscription with its plan, or null. */
  getSubscription(companyId: string) {
    return this.prisma.subscription.findUnique({
      where: { companyId },
      include: { plan: true },
    });
  }

  /**
   * Resolve the effective features for a company from its active subscription
   * plan. Falls back to Starter defaults when there is no plan (should not happen
   * once a company is created — every company gets a SYSTEM subscription).
   */
  async getCompanyFeatures(companyId: string): Promise<CompanyFeatures> {
    const sub = await this.prisma.subscription.findUnique({
      where: { companyId },
      include: { plan: true },
    });
    if (!sub) return STARTER_FEATURES;
    return this.resolveFeatures(sub.plan);
  }

  /**
   * Upgrade copy for a plan-limit error, e.g. "Upgrade to Pro or Managed to add
   * more." Names the plans (other than the company's current one) whose features
   * pass `unlocks`, cheapest first, so the message follows the plan catalogue.
   */
  async upgradeHint(
    current: CompanyFeatures,
    unlocks: (features: CompanyFeatures) => boolean,
    action: string,
  ): Promise<string> {
    const plans = await this.listPlans();
    const names = plans
      .filter((p) => p.tier !== current.tier && unlocks(this.resolveFeatures(p)))
      .map((p) => p.name);
    if (names.length === 0) return `Contact us at hello@taplino.ch ${action}.`;
    const list =
      names.length === 1
        ? names[0]
        : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
    return `Upgrade to ${list} ${action}.`;
  }

  private resolveFeatures(plan: SubscriptionPlan): CompanyFeatures {
    const f = (plan.features ?? {}) as Partial<CompanyFeatures>;
    return {
      tier: plan.tier,
      analytics: f.analytics ?? STARTER_FEATURES.analytics,
      multiLocation: f.multiLocation ?? STARTER_FEATURES.multiLocation,
      maxLocations: f.maxLocations === undefined ? STARTER_FEATURES.maxLocations : f.maxLocations,
      unlimitedDestinationChanges:
        f.unlimitedDestinationChanges ?? STARTER_FEATURES.unlimitedDestinationChanges,
      managed: f.managed ?? STARTER_FEATURES.managed,
      createPages: f.createPages ?? STARTER_FEATURES.createPages,
    };
  }
}
