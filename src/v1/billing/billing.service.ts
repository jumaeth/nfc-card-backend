import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

/** Resolved feature set for a company, after applying its subscription plan. */
export interface CompanyFeatures {
  tier: string;
  analytics: boolean;
  multiLocation: boolean;
  /** null = unlimited. */
  maxLocations: number | null;
  unlimitedDestinationChanges: boolean;
  managed: boolean;
}

// Conservative defaults for a company with no resolvable plan (Starter tier).
const STARTER_FEATURES: CompanyFeatures = {
  tier: 'STARTER',
  analytics: false,
  multiLocation: false,
  maxLocations: 1,
  unlimitedDestinationChanges: false,
  managed: false,
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

    const f = (sub.plan.features ?? {}) as Partial<CompanyFeatures>;
    return {
      tier: sub.plan.tier,
      analytics: f.analytics ?? STARTER_FEATURES.analytics,
      multiLocation: f.multiLocation ?? STARTER_FEATURES.multiLocation,
      maxLocations: f.maxLocations === undefined ? STARTER_FEATURES.maxLocations : f.maxLocations,
      unlimitedDestinationChanges:
        f.unlimitedDestinationChanges ?? STARTER_FEATURES.unlimitedDestinationChanges,
      managed: f.managed ?? STARTER_FEATURES.managed,
    };
  }
}
