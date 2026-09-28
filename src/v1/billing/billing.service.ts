import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';
import { PrismaService, type TxClient } from '../../prisma/prisma.service.js';
import { StripeService } from './stripe.service.js';
import { planLookupKey, planProductId } from './plan-prices.js';
import { log, error as logError, LogKey } from '../../logger/index.js';
import type {
  PlanTier,
  SubscriptionPlan,
  SubscriptionStatus,
} from '../../../generated/prisma/client.js';

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

// Stripe subscription status → ours. `incomplete` is left out on purpose: the
// first payment has not gone through, so the plan must not change yet.
const STRIPE_STATUS: Partial<
  Record<Stripe.Subscription.Status, SubscriptionStatus>
> = {
  trialing: 'TRIALING',
  active: 'ACTIVE',
  past_due: 'PAST_DUE',
  unpaid: 'PAST_DUE',
  paused: 'PAUSED',
  canceled: 'CANCELLED',
  incomplete_expired: 'CANCELLED',
};

// Period end of the Starter baseline every company falls back to.
const OPEN_ENDED = new Date('9999-12-31');

// How long a price found by lookup key is reused before asking Stripe again.
const PRICE_CACHE_MS = 10 * 60 * 1000;

@Injectable()
export class BillingService {
  private readonly appUrl: string;
  private readonly prices = new Map<string, { id: string; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    config: ConfigService,
  ) {
    this.appUrl = (
      config.get<string>('FRONTEND_URL') ?? 'http://localhost:3310'
    )
      .split(',')[0]
      .trim()
      .replace(/\/$/, '');
  }

  /** Plans can be changed from the app (through Stripe, or simulated locally). */
  get onlineBilling(): boolean {
    return this.stripe.enabled || this.simulated;
  }

  /** Local development without STRIPE_SECRET_KEY: plan changes apply at once. */
  get simulated(): boolean {
    return !this.stripe.enabled && !this.stripe.isProduction;
  }

  /** The plan catalogue (public). Ordered cheapest first. */
  listPlans() {
    return this.prisma.subscriptionPlan.findMany({
      orderBy: { priceCents: 'asc' },
    });
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
   * Whether the company's pages are live and editable: its plan includes pages,
   * or staff turned on the override. Otherwise they stay stored but read-only,
   * and their public links go to the marketing site.
   */
  async pagesActive(
    companyId: string,
    features?: CompanyFeatures,
  ): Promise<boolean> {
    if (features?.createPages) return true;
    // Bypasses RLS: public routes (page links, card taps) have no tenant.
    const company = await this.prisma.$asAdmin((tx) =>
      tx.company.findUnique({
        where: { id: companyId },
        select: {
          pagesOverride: true,
          subscription: { select: { plan: true } },
        },
      }),
    );
    if (!company) return false;
    if (company.pagesOverride) return true;
    const plan = company.subscription?.plan;
    return plan
      ? this.resolveFeatures(plan).createPages
      : STARTER_FEATURES.createPages;
  }

  /** Refuse page changes while the company's pages are read-only. */
  async assertPagesActive(companyId: string) {
    if (!(await this.pagesActive(companyId))) {
      throw new ForbiddenException(
        'Your plan does not include pages. They are kept but offline. Upgrade to edit and publish them.',
      );
    }
  }

  /** How many locations the plan allows. null = unlimited. */
  locationLimit(features: CompanyFeatures): number | null {
    return features.multiLocation ? features.maxLocations : 1;
  }

  /**
   * Fit the editable locations to the plan after a plan change. The default
   * comes first, then those editable now, then the oldest. The rest become
   * read-only (never deleted) until an upgrade or the customer picks others.
   */
  async applyLocationLimit(
    tx: TxClient,
    companyId: string,
    features: CompanyFeatures,
  ) {
    const locations = await tx.location.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, isDefault: true, readOnly: true },
      orderBy: { createdAt: 'asc' },
    });
    const limit = this.locationLimit(features) ?? locations.length;
    // Array sort is stable, so equal ranks keep the oldest first.
    const ranked = [...locations].sort(
      (a, b) =>
        Number(b.isDefault) - Number(a.isDefault) ||
        Number(a.readOnly) - Number(b.readOnly),
    );
    const keep = new Set(ranked.slice(0, limit).map((l) => l.id));
    const lock = locations.filter((l) => !keep.has(l.id) && !l.readOnly);
    const unlock = locations.filter((l) => keep.has(l.id) && l.readOnly);
    if (lock.length === 0 && unlock.length === 0) return;
    await tx.location.updateMany({
      where: { id: { in: lock.map((l) => l.id) } },
      data: { readOnly: true },
    });
    await tx.location.updateMany({
      where: { id: { in: unlock.map((l) => l.id) } },
      data: { readOnly: false },
    });
    log(LogKey.LOCATIONS_LIMIT_APPLIED, 'Location limit applied', {
      companyId,
      readOnly: lock.length,
      editable: unlock.length,
    });
  }

  /** Re-apply the location limit for every company on a plan (its limits changed). */
  async applyPlanLimits(planId: string) {
    await this.prisma.$asAdmin(async (tx) => {
      const plan = await tx.subscriptionPlan.findUniqueOrThrow({
        where: { id: planId },
      });
      const subs = await tx.subscription.findMany({
        where: { planId },
        select: { companyId: true },
      });
      for (const { companyId } of subs) {
        await this.applyLocationLimit(
          tx,
          companyId,
          this.resolveFeatures(plan),
        );
      }
    });
  }

  /** Apply a company's (new) plan to its data. Call after changing the subscription. */
  async applyCompanyPlan(
    tx: TxClient,
    companyId: string,
    plan: SubscriptionPlan,
  ) {
    await this.applyLocationLimit(tx, companyId, this.resolveFeatures(plan));
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
      .filter(
        (p) => p.tier !== current.tier && unlocks(this.resolveFeatures(p)),
      )
      .map((p) => p.name);
    if (names.length === 0) return `Contact us at hello@taplino.ch ${action}.`;
    const list =
      names.length === 1
        ? names[0]
        : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
    return `Upgrade to ${list} ${action}.`;
  }

  // ─── Stripe self-serve ──────────────────────────────────────────────────────

  /** Whether the company already has a Stripe customer (the portal needs one). */
  async hasBillingAccount(companyId: string): Promise<boolean> {
    const customer = await this.prisma.stripeCustomer.findUnique({
      where: { companyId },
      select: { id: true },
    });
    return Boolean(customer);
  }

  /**
   * Start a plan change and return the Stripe URL to send the customer to.
   * Without a Stripe subscription that is Checkout; with one it is the billing
   * portal, opened on the confirmation screen for the new plan (or the cancel
   * screen when going back to Starter), so Stripe handles proration.
   */
  async startPlanChange(
    companyId: string,
    user: { email: string },
    tier: PlanTier,
  ): Promise<{ url: string }> {
    const [plan, current] = await Promise.all([
      this.prisma.subscriptionPlan.findUnique({ where: { tier } }),
      this.getSubscription(companyId),
    ]);
    if (!plan) throw new NotFoundException('Plan not found');
    if (current?.plan.tier === tier) {
      throw new ConflictException('You are already on this plan.');
    }
    if (current?.source === 'MANUAL' && current.plan.tier !== 'STARTER') {
      throw new ConflictException(
        'Your plan is managed by Taplino. Contact us at hello@taplino.ch to change it.',
      );
    }

    const returnUrl = `${this.appUrl}/app/settings`;

    if (this.simulated) {
      await this.simulatePlanChange(companyId, plan);
      return { url: `${returnUrl}?billing=simulated` };
    }
    const stripe = this.requireStripe();

    if (current?.source === 'STRIPE' && current.stripeSubscriptionId) {
      const customer = await this.requireCustomerId(companyId);
      if (plan.interval === 'ONE_TIME') {
        const session = await stripe.billingPortal.sessions.create({
          customer,
          return_url: returnUrl,
          flow_data: {
            type: 'subscription_cancel',
            subscription_cancel: { subscription: current.stripeSubscriptionId },
            after_completion: {
              type: 'redirect',
              redirect: { return_url: returnUrl },
            },
          },
        });
        return { url: session.url };
      }
      const priceId = await this.requirePrice(plan);
      const sub = await stripe.subscriptions.retrieve(
        current.stripeSubscriptionId,
      );
      const session = await stripe.billingPortal.sessions.create({
        customer,
        return_url: returnUrl,
        flow_data: {
          type: 'subscription_update_confirm',
          subscription_update_confirm: {
            subscription: sub.id,
            items: [{ id: sub.items.data[0].id, price: priceId, quantity: 1 }],
          },
          after_completion: {
            type: 'redirect',
            redirect: { return_url: returnUrl },
          },
        },
      });
      return { url: session.url };
    }

    if (plan.interval === 'ONE_TIME') {
      throw new BadRequestException('You are already on the base plan.');
    }
    const priceId = await this.requirePrice(plan);
    const customer = await this.ensureCustomer(companyId, user.email);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      client_reference_id: companyId,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { companyId, tier },
      subscription_data: { metadata: { companyId, tier } },
      allow_promotion_codes: true,
      billing_address_collection: 'required',
      customer_update: { address: 'auto', name: 'auto' },
      success_url: `${returnUrl}?billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${returnUrl}?billing=cancelled`,
    });
    log(LogKey.BILLING_CHECKOUT_CREATED, 'Subscription checkout created', {
      companyId,
      tier,
      sessionId: session.id,
    });
    if (!session.url)
      throw new ServiceUnavailableException('Stripe returned no checkout URL.');
    return { url: session.url };
  }

  /** Stripe billing portal for invoices, payment method and cancellation. */
  async portalUrl(companyId: string): Promise<{ url: string }> {
    const stripe = this.requireStripe();
    const customer = await this.requireCustomerId(companyId);
    const session = await stripe.billingPortal.sessions.create({
      customer,
      return_url: `${this.appUrl}/app/settings`,
    });
    return { url: session.url };
  }

  /**
   * Called when the customer lands back from Checkout, so the new plan shows
   * right away instead of waiting for the webhook (which may not reach local
   * development at all). Safe to repeat.
   */
  async confirmCheckout(companyId: string, sessionId: string) {
    const stripe = this.requireStripe();
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId);
    } catch {
      throw new NotFoundException('Checkout session not found');
    }
    if (
      session.client_reference_id !== companyId ||
      session.mode !== 'subscription'
    ) {
      throw new NotFoundException('Checkout session not found');
    }
    const subscriptionId = stripeId(session.subscription);
    if (subscriptionId) await this.syncStripeSubscription(subscriptionId);
    return this.getSubscription(companyId);
  }

  /** Subscription side of the Stripe webhook. Card orders are handled in OrdersService. */
  async handleStripeEvent(event: Stripe.Event) {
    switch (event.type) {
      case 'checkout.session.completed': {
        const subscriptionId = stripeId(event.data.object.subscription);
        if (event.data.object.mode === 'subscription' && subscriptionId) {
          await this.syncStripeSubscription(subscriptionId);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed':
        await this.syncStripeSubscription(event.data.object.id);
        break;
      default:
        break;
    }
  }

  /**
   * Mirror a Stripe subscription onto the company's Subscription row. Always
   * reads the latest state from Stripe, so events arriving late or out of
   * order cannot roll it back. An ended subscription drops the company back to
   * Starter.
   */
  async syncStripeSubscription(subscriptionId: string) {
    const sub = await this.stripe.client.subscriptions.retrieve(subscriptionId);
    const status = STRIPE_STATUS[sub.status];
    if (!status) return;
    const customerId = stripeId(sub.customer);
    const item = sub.items.data[0];

    await this.prisma.$asAdmin(async (tx) => {
      const companyId =
        sub.metadata.companyId ??
        (customerId
          ? (
              await tx.stripeCustomer.findUnique({
                where: { stripeCustomerId: customerId },
              })
            )?.companyId
          : undefined);
      if (!companyId) {
        logError(
          LogKey.BILLING_WEBHOOK_ERROR,
          'Stripe subscription without a company',
          {
            subscriptionId,
          },
        );
        return;
      }
      const current = await tx.subscription.findUnique({
        where: { companyId },
      });
      const isCurrent = current?.stripeSubscriptionId === sub.id;

      if (status === 'CANCELLED') {
        // Only an ended subscription that is still the company's own resets it.
        if (!isCurrent) return;
        const starter = await tx.subscriptionPlan.findUniqueOrThrow({
          where: { tier: 'STARTER' },
        });
        await tx.subscription.update({
          where: { companyId },
          data: {
            planId: starter.id,
            status: 'ACTIVE',
            source: 'SYSTEM',
            interval: starter.interval,
            currentPeriodStart: new Date(),
            currentPeriodEnd: OPEN_ENDED,
            stripeSubscriptionId: null,
            cancelAt: null,
          },
        });
        await this.applyCompanyPlan(tx, companyId, starter);
        log(LogKey.BILLING_SUBSCRIPTION_UPDATED, 'Stripe subscription ended', {
          companyId,
          subscriptionId,
        });
        return;
      }

      // The price's tier (set by `pnpm stripe:plans`), else its product
      // (taplino_plan_<tier>). Both survive a price change, so subscribers on
      // an archived older price still resolve to their plan.
      const price = item?.price;
      const productId =
        typeof price?.product === 'string' ? price.product : price?.product.id;
      const tier =
        price?.metadata.tier ??
        productId?.match(/^taplino_plan_(\w+)$/)?.[1].toUpperCase();
      const plan = isPlanTier(tier)
        ? await tx.subscriptionPlan.findUnique({ where: { tier } })
        : null;
      if (!plan) {
        // Throw so Stripe retries while the price is fixed in Stripe.
        throw new Error(`No plan for Stripe price ${price?.id ?? '(none)'}`);
      }
      const data = {
        planId: plan.id,
        status,
        source: 'STRIPE' as const,
        interval: plan.interval,
        currentPeriodStart: new Date(item.current_period_start * 1000),
        currentPeriodEnd: new Date(item.current_period_end * 1000),
        stripeSubscriptionId: sub.id,
        cancelAt: sub.cancel_at ? new Date(sub.cancel_at * 1000) : null,
      };
      await tx.subscription.upsert({
        where: { companyId },
        create: { companyId, ...data },
        update: data,
      });
      await this.applyCompanyPlan(tx, companyId, plan);
      if (customerId) {
        await tx.stripeCustomer.upsert({
          where: { companyId },
          create: { companyId, stripeCustomerId: customerId },
          update: {},
        });
      }
      log(LogKey.BILLING_SUBSCRIPTION_UPDATED, 'Stripe subscription synced', {
        companyId,
        subscriptionId,
        tier: plan.tier,
        status,
      });
    });
  }

  /**
   * Stand-in for Checkout when Stripe is not configured outside production:
   * switch the plan as if the payment went through. Kept as a SYSTEM
   * subscription so staff can still change it and nothing points at Stripe.
   */
  private async simulatePlanChange(companyId: string, plan: SubscriptionPlan) {
    const now = new Date();
    const periodEnd = new Date(now);
    if (plan.interval === 'MONTHLY')
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    else if (plan.interval === 'YEARLY')
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    const data = {
      planId: plan.id,
      status: 'ACTIVE' as const,
      source: 'SYSTEM' as const,
      interval: plan.interval,
      currentPeriodStart: now,
      currentPeriodEnd: plan.interval === 'ONE_TIME' ? OPEN_ENDED : periodEnd,
      stripeSubscriptionId: null,
      cancelAt: null,
    };
    await this.prisma.$asAdmin(async (tx) => {
      await tx.subscription.upsert({
        where: { companyId },
        create: { companyId, ...data },
        update: data,
      });
      await this.applyCompanyPlan(tx, companyId, plan);
    });
    log(
      LogKey.BILLING_SUBSCRIPTION_UPDATED,
      'Plan changed (simulated payment)',
      {
        companyId,
        tier: plan.tier,
      },
    );
  }

  private requireStripe(): Stripe {
    if (!this.stripe.enabled) {
      throw new ServiceUnavailableException(
        'Online billing is not available right now.',
      );
    }
    return this.stripe.client;
  }

  /** The plan's active Stripe price, found by its lookup key. */
  private async requirePrice(plan: SubscriptionPlan): Promise<string> {
    const key = planLookupKey(plan);
    const cached = this.prices.get(key);
    if (cached && Date.now() - cached.at < PRICE_CACHE_MS) return cached.id;

    const [price] = (
      await this.requireStripe().prices.list({
        lookup_keys: [key],
        active: true,
        limit: 1,
      })
    ).data;
    const productId =
      typeof price?.product === 'string' ? price.product : price?.product.id;
    if (!price || productId !== planProductId(plan)) {
      logError(LogKey.BILLING_PRICE_MISSING, 'No Stripe price for plan', {
        tier: plan.tier,
        lookupKey: key,
      });
      throw new BadRequestException(
        `${plan.name} cannot be booked online yet. Contact us at hello@taplino.ch.`,
      );
    }
    this.prices.set(key, { id: price.id, at: Date.now() });
    return price.id;
  }

  private async requireCustomerId(companyId: string): Promise<string> {
    const customer = await this.prisma.stripeCustomer.findUnique({
      where: { companyId },
    });
    if (!customer) throw new NotFoundException('No billing account yet');
    return customer.stripeCustomerId;
  }

  /** The company's Stripe customer, created on first checkout. */
  private async ensureCustomer(
    companyId: string,
    fallbackEmail: string,
  ): Promise<string> {
    const existing = await this.prisma.stripeCustomer.findUnique({
      where: { companyId },
    });
    if (existing) return existing.stripeCustomerId;
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { name: true, billingEmail: true },
    });
    // Idempotency key: a double click within a day returns the same customer.
    const customer = await this.requireStripe().customers.create(
      {
        name: company.name,
        email: company.billingEmail ?? fallbackEmail,
        metadata: { companyId },
      },
      { idempotencyKey: `taplino-customer-${companyId}` },
    );
    const saved = await this.prisma.$asAdmin((tx) =>
      tx.stripeCustomer.upsert({
        where: { companyId },
        create: { companyId, stripeCustomerId: customer.id },
        update: {},
      }),
    );
    return saved.stripeCustomerId;
  }

  private resolveFeatures(plan: SubscriptionPlan): CompanyFeatures {
    const f = (plan.features ?? {}) as Partial<CompanyFeatures>;
    return {
      tier: plan.tier,
      analytics: f.analytics ?? STARTER_FEATURES.analytics,
      multiLocation: f.multiLocation ?? STARTER_FEATURES.multiLocation,
      maxLocations:
        f.maxLocations === undefined
          ? STARTER_FEATURES.maxLocations
          : f.maxLocations,
      unlimitedDestinationChanges:
        f.unlimitedDestinationChanges ??
        STARTER_FEATURES.unlimitedDestinationChanges,
      managed: f.managed ?? STARTER_FEATURES.managed,
      createPages: f.createPages ?? STARTER_FEATURES.createPages,
    };
  }
}

/** The id of an expandable Stripe field. */
function stripeId(
  value: string | { id: string } | null | undefined,
): string | undefined {
  if (!value) return undefined;
  return typeof value === 'string' ? value : value.id;
}

const PLAN_TIERS: readonly string[] = ['STARTER', 'PRO', 'MANAGED'];

function isPlanTier(value: string | undefined): value is PlanTier {
  return value !== undefined && PLAN_TIERS.includes(value);
}
