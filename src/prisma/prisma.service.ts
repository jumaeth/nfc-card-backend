import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '../../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { withRls, APP_ROLE } from './rls.extension.js';
import { getTenantUserId } from './tenant-context.js';
import { log, warn, error, LogKey } from '../logger/index.js';

type Client = InstanceType<typeof PrismaClient>;

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  /** Raw client — no RLS context. Used by better-auth (auth tables are not
   *  tenant-scoped) and as the engine that runs the context-setting. */
  private readonly base: Client;
  /** Context-aware client: every operation stamps `app.current_user_id` for RLS.
   *  All application model access goes through this. */
  private readonly client: Client;

  constructor(configService: ConfigService) {
    const adapter = new PrismaPg({
      connectionString: configService.getOrThrow<string>('DATABASE_URL'),
      max: Number(configService.get<string>('DB_POOL_MAX') ?? 10),
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: Number(
        configService.get<string>('DB_STATEMENT_TIMEOUT_MS') ?? 30_000,
      ),
    });
    this.base = new PrismaClient({ adapter });
    this.client = withRls(this.base);
  }

  /** Raw, non-RLS client. Only for auth/better-auth. Do NOT use for tenant data. */
  get $prisma(): Client {
    return this.base;
  }

  // ─── Auth models (not RLS-secured) ──────────────────────────────────────────
  get user() {
    return this.client.user;
  }
  get session() {
    return this.client.session;
  }
  get account() {
    return this.client.account;
  }
  get verification() {
    return this.client.verification;
  }
  get passkey() {
    return this.client.passkey;
  }

  // ─── Tenant models (RLS-secured) ────────────────────────────────────────────
  get company() {
    return this.client.company;
  }
  get companySettings() {
    return this.client.companySettings;
  }
  get companyMember() {
    return this.client.companyMember;
  }
  get location() {
    return this.client.location;
  }
  get card() {
    return this.client.card;
  }
  get page() {
    return this.client.page;
  }
  get tapEvent() {
    return this.client.tapEvent;
  }
  get invitation() {
    return this.client.invitation;
  }
  get subscription() {
    return this.client.subscription;
  }
  get stripeCustomer() {
    return this.client.stripeCustomer;
  }

  // ─── Global catalogue (not RLS-secured) ─────────────────────────────────────
  get subscriptionPlan() {
    return this.client.subscriptionPlan;
  }
  get product() {
    return this.client.product;
  }

  // ─── Shop orders (not RLS-secured; OrdersService scopes access) ─────────────
  get order() {
    return this.client.order;
  }
  get orderItem() {
    return this.client.orderItem;
  }

  /**
   * Interactive transaction carrying the current request's tenant context. Sets
   * `app.current_user_id` first so every query inside is subject to the same RLS
   * scope. Runs on the base client (the RLS extension does not intercept it).
   */
  async $transaction<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
    const userId = getTenantUserId();
    return this.base.$transaction(async (tx) => {
      if (userId) {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${APP_ROLE}`);
      }
      return fn(tx);
    });
  }

  /**
   * Privileged transaction for trusted, server-initiated operations that must
   * bootstrap a company that does not exist yet, or write from an unauthenticated
   * context (e.g. recording a public tap event). Sets `app.bypass_rls` so
   * policies pass. Use SPARINGLY and only from code that scopes correctly itself.
   */
  async $asAdmin<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
    const userId = getTenantUserId();
    return this.base.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      if (userId) {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
      }
      return fn(tx);
    });
  }

  async onModuleInit() {
    const maxAttempts = 10;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.base.$connect();
        if (attempt > 1) {
          log(LogKey.DB_CONNECT_OK, 'Database connection established', { attempt });
        }
        return;
      } catch (err) {
        if (attempt === maxAttempts) {
          error(LogKey.DB_CONNECT_FAILED, 'Database unreachable after retries; giving up', {
            attempts: attempt,
            err: String(err),
          });
          throw err;
        }
        const delayMs = Math.min(1000 * 2 ** (attempt - 1), 30_000);
        warn(LogKey.DB_CONNECT_RETRY, 'Database unreachable; retrying', {
          attempt,
          nextDelayMs: delayMs,
          err: String(err),
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  async onModuleDestroy() {
    await this.base.$disconnect();
  }

  /** Liveness probe for the DB connection (used by the readiness health check). */
  async ping(): Promise<boolean> {
    try {
      await this.base.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}

/** The client surface available inside an interactive transaction callback. */
export type TxClient = Omit<
  Client,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
