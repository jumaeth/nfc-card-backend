import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/**
 * Thin wrapper around the Stripe SDK, shared by card orders and plan
 * subscriptions. `enabled` is false without STRIPE_SECRET_KEY; OrdersService
 * then simulates payment outside production.
 */
@Injectable()
export class StripeService {
  private readonly stripe?: Stripe;
  private readonly webhookSecret?: string;
  readonly isProduction: boolean;

  constructor(config: ConfigService) {
    const key = config.get<string>('STRIPE_SECRET_KEY');
    if (key) this.stripe = new Stripe(key);
    this.webhookSecret =
      config.get<string>('STRIPE_WEBHOOK_SECRET') || undefined;
    this.isProduction = config.get<string>('NODE_ENV') === 'production';
  }

  get enabled(): boolean {
    return Boolean(this.stripe);
  }

  /** The SDK client. Throws when Stripe is not configured. */
  get client(): Stripe {
    if (!this.stripe) throw new Error('Stripe is not configured');
    return this.stripe;
  }

  createCheckoutSession(params: Stripe.Checkout.SessionCreateParams) {
    if (!this.stripe) throw new Error('Stripe is not configured');
    return this.stripe.checkout.sessions.create(params);
  }

  /** Verify and parse a webhook payload. Throws on a bad signature. */
  constructEvent(rawBody: Buffer, signature: string): Stripe.Event {
    if (!this.stripe || !this.webhookSecret) {
      throw new Error('Stripe webhook is not configured');
    }
    return this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      this.webhookSecret,
    );
  }
}
