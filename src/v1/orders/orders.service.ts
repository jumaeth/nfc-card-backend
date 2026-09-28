import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { customAlphabet } from 'nanoid';
import type Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CompanyAccessService } from '../companies/company-access.service.js';
import { ProductsService } from '../products/products.service.js';
import { EmailService } from '../../email/email.service.js';
import { StripeService } from '../billing/stripe.service.js';
import {
  CURRENCY,
  priceLine,
  SHIPPING_CENTS,
  VOLUME_TIERS,
} from './pricing.js';
import { log, error as logError, LogKey } from '../../logger/index.js';
import { platformRoleAtLeast } from '../../common/permissions.js';
import {
  Prisma,
  type CardType,
  type Order,
  type OrderStatus,
  type User,
} from '../../../generated/prisma/client.js';
import type {
  CompanyOrderDto,
  GuestOrderDto,
  ListOrdersQueryDto,
  OrderItemDto,
  ShippingAddressDto,
  ShopLocale,
  UpdateOrderStatusDto,
} from './dto/orders.dto.js';

// Human-friendly order reference without look-alike characters (0/O, 1/I).
const orderCode = customAlphabet('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 6);
// Same alphabet and length as CardsService's tap slugs.
const cardSlug = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);

// The editor's CardConfig, logo included as a data URL. Keeps a single order
// row reasonable; the editor downscales logos well below this.
const MAX_DESIGN_BYTES = 700_000;

// Which app card type a physical product starts as. Customers can re-point
// any card to any page later.
const CARD_TYPE_FOR_PRODUCT: Record<string, CardType> = {
  business: 'VCARD',
  review: 'REVIEW',
};

// Orders whose cards exist or will exist; what a customer can link.
const CLAIMABLE_STATUSES: OrderStatus[] = ['PAID', 'IN_PRODUCTION', 'SHIPPED'];

const ITEM_SUMMARY_SELECT = {
  id: true,
  productKey: true,
  productName: true,
  quantity: true,
  unitPriceCents: true,
  discountPercent: true,
  lineTotalCents: true,
} satisfies Prisma.OrderItemSelect;

const ORDER_SUMMARY_INCLUDE = {
  items: { select: ITEM_SUMMARY_SELECT, orderBy: { createdAt: 'asc' } },
  _count: { select: { cards: true } },
} satisfies Prisma.OrderInclude;

type OrderSummaryRow = Prisma.OrderGetPayload<{
  include: typeof ORDER_SUMMARY_INCLUDE;
}>;

interface OrderContext {
  kind: 'guest' | 'company';
  companyId?: string;
  userId?: string;
}

interface OrderInput {
  email: string;
  customerName: string;
  phone?: string;
  companyName?: string;
  shippingAddress: ShippingAddressDto;
  locale: ShopLocale;
  items: OrderItemDto[];
}

@Injectable()
export class OrdersService {
  private readonly websiteUrl: string;
  private readonly appUrl: string;
  private readonly ordersEmail?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    private readonly access: CompanyAccessService,
    private readonly stripe: StripeService,
    private readonly email: EmailService,
    config: ConfigService,
  ) {
    this.websiteUrl = config
      .get<string>('WEBSITE_URL', 'http://localhost:3000')
      .replace(/\/$/, '');
    this.appUrl = (
      config.get<string>('FRONTEND_URL') ?? 'http://localhost:3310'
    )
      .split(',')[0]
      .trim()
      .replace(/\/$/, '');
    // Paid orders are announced to this inbox (via Resend when configured).
    this.ordersEmail =
      config.get<string>('ORDERS_EMAIL', 'orders@taplino.ch') || undefined;
  }

  // ─── Public shop config ─────────────────────────────────────────────────────

  async shopConfig() {
    return {
      products: await this.products.listPublic(),
      volumeTiers: VOLUME_TIERS,
      currency: CURRENCY,
      shippingCents: SHIPPING_CENTS,
    };
  }

  // ─── Checkout ───────────────────────────────────────────────────────────────

  createGuestOrder(dto: GuestOrderDto) {
    return this.createOrder(
      {
        email: dto.email,
        customerName: dto.customerName,
        phone: dto.phone,
        companyName: dto.companyName,
        shippingAddress: dto.shippingAddress,
        locale: dto.locale ?? 'de',
        items: dto.items,
      },
      { kind: 'guest' },
    );
  }

  async createCompanyOrder(
    companyId: string,
    user: User,
    dto: CompanyOrderDto,
  ) {
    await this.access.requireManager(user.id, companyId);
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true },
    });
    if (!company) throw new NotFoundException('Company not found');

    return this.createOrder(
      {
        email: user.email,
        customerName: dto.customerName || user.name || user.email,
        phone: dto.phone,
        companyName: dto.companyName || company.name,
        shippingAddress: dto.shippingAddress,
        locale: dto.locale ?? 'de',
        items: dto.items,
      },
      { kind: 'company', companyId, userId: user.id },
    );
  }

  private async createOrder(input: OrderInput, ctx: OrderContext) {
    for (const item of input.items) {
      if (Buffer.byteLength(JSON.stringify(item.design)) > MAX_DESIGN_BYTES) {
        throw new BadRequestException(
          'The card design is too large. Please use a smaller logo.',
        );
      }
    }

    // Price every line from the live catalogue, never from the client. The
    // volume discount is per product, on the order's total for that product.
    const catalogue = await this.products.listAll();
    const productQty = new Map<string, number>();
    for (const item of input.items) {
      productQty.set(item.productKey, (productQty.get(item.productKey) ?? 0) + item.quantity);
    }
    const lines = input.items.map((item) => {
      const product = catalogue.find((p) => p.key === item.productKey);
      if (!product)
        throw new BadRequestException(`Unknown product: ${item.productKey}`);
      if (!product.active) {
        throw new ConflictException(
          `${product.name} is currently not available`,
        );
      }
      return {
        item,
        product,
        price: priceLine(
          product.priceCents,
          item.quantity,
          productQty.get(item.productKey),
        ),
      };
    });

    const subtotalCents = lines.reduce((sum, l) => sum + l.price.grossCents, 0);
    const itemsTotal = lines.reduce(
      (sum, l) => sum + l.price.lineTotalCents,
      0,
    );
    const discountCents = subtotalCents - itemsTotal;
    const totalCents = itemsTotal + SHIPPING_CENTS;

    // Reserve stock up front (atomic per product) so two buyers can never pay
    // for the last cards. Released again if the checkout is abandoned.
    const reserved: { key: string; quantity: number }[] = [];
    try {
      for (const l of lines) {
        await this.products.reserve(l.product.key, l.item.quantity);
        reserved.push({ key: l.product.key, quantity: l.item.quantity });
      }
    } catch (err) {
      await this.releaseReserved(reserved);
      throw err;
    }

    let order: Order;
    try {
      order = await this.createOrderRow({
        email: input.email.trim().toLowerCase(),
        customerName: input.customerName.trim(),
        phone: input.phone?.trim() || null,
        companyName: input.companyName?.trim() || null,
        shippingAddress: {
          ...input.shippingAddress,
          country: input.shippingAddress.country.toUpperCase(),
        },
        locale: input.locale,
        companyId: ctx.companyId ?? null,
        placedByUserId: ctx.userId ?? null,
        claimedAt: ctx.companyId ? new Date() : null,
        subtotalCents,
        discountCents,
        shippingCents: SHIPPING_CENTS,
        totalCents,
        currency: CURRENCY,
        items: {
          create: lines.map((l) => ({
            productKey: l.product.key,
            productName: l.product.name,
            quantity: l.item.quantity,
            unitPriceCents: l.price.unitPriceCents,
            discountPercent: l.price.discountPercent,
            lineTotalCents: l.price.lineTotalCents,
            design: l.item.design as Prisma.InputJsonValue,
          })),
        },
      });
    } catch (err) {
      await this.releaseReserved(reserved);
      throw err;
    }

    log(LogKey.ORDER_CREATED, 'Order created', {
      orderId: order.id,
      number: order.number,
      kind: ctx.kind,
      companyId: ctx.companyId,
      totalCents,
    });

    const successUrl =
      ctx.kind === 'guest'
        ? `${this.websiteUrl}/${input.locale}/order/success?session_id={CHECKOUT_SESSION_ID}`
        : `${this.appUrl}/app/orders?paid=${order.number}`;
    const cancelUrl =
      ctx.kind === 'guest'
        ? `${this.websiteUrl}/${input.locale}/editor?cancelled=1`
        : `${this.appUrl}/app/orders/new?cancelled=1`;

    if (!this.stripe.enabled) {
      if (this.stripe.isProduction) {
        await this.expireOrder(order.id);
        throw new ServiceUnavailableException(
          'Online payment is not available right now.',
        );
      }
      // Local development without Stripe: treat the order as paid right away.
      const sessionId = `dev_${order.id}`;
      await this.prisma.order.update({
        where: { id: order.id },
        data: { stripeSessionId: sessionId },
      });
      await this.markPaid(sessionId);
      return {
        orderId: order.id,
        number: order.number,
        checkoutUrl: successUrl.replace('{CHECKOUT_SESSION_ID}', sessionId),
      };
    }

    try {
      const session = await this.stripe.createCheckoutSession({
        mode: 'payment',
        client_reference_id: order.id,
        customer_email: order.email,
        locale: input.locale,
        // Stripe's minimum. Abandoned checkouts free their stock after this.
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { orderId: order.id, orderNumber: order.number },
        payment_intent_data: {
          metadata: { orderId: order.id, orderNumber: order.number },
        },
        line_items: lines.map((l) => ({
          quantity: l.item.quantity,
          price_data: {
            currency: CURRENCY.toLowerCase(),
            unit_amount: l.price.unitPriceCents,
            product_data: {
              name: l.product.name,
              ...(l.price.discountPercent > 0 && {
                description: `${l.price.discountPercent}% volume discount`,
              }),
            },
          },
        })),
      });
      await this.prisma.order.update({
        where: { id: order.id },
        data: { stripeSessionId: session.id },
      });
      if (!session.url) throw new Error('Stripe returned no checkout URL');
      return {
        orderId: order.id,
        number: order.number,
        checkoutUrl: session.url,
      };
    } catch (err) {
      logError(LogKey.ORDER_WEBHOOK_ERROR, 'Stripe checkout session failed', {
        orderId: order.id,
        err: err instanceof Error ? err.message : String(err),
      });
      await this.expireOrder(order.id);
      throw new ServiceUnavailableException(
        'Could not start the payment. Please try again.',
      );
    }
  }

  /** Insert the order, retrying the rare order-number collision. */
  private async createOrderRow(
    data: Omit<Prisma.OrderUncheckedCreateInput, 'number'>,
  ) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.prisma.order.create({
          data: { ...data, number: `TPL-${orderCode()}` },
        });
      } catch (err) {
        const clash =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002';
        if (!clash) throw err;
      }
    }
    throw new ServiceUnavailableException(
      'Could not create the order, please retry',
    );
  }

  private async releaseReserved(reserved: { key: string; quantity: number }[]) {
    for (const r of reserved) {
      await this.products.release(r.key, r.quantity).catch(() => undefined);
    }
  }

  // ─── Payment lifecycle ──────────────────────────────────────────────────────

  async handleStripeEvent(event: Stripe.Event) {
    switch (event.type) {
      case 'checkout.session.completed':
        // Card payments are paid here; delayed methods confirm via async_*.
        if (event.data.object.payment_status === 'paid') {
          await this.markPaid(
            event.data.object.id,
            paymentIntentId(event.data.object),
          );
        }
        break;
      case 'checkout.session.async_payment_succeeded':
        await this.markPaid(
          event.data.object.id,
          paymentIntentId(event.data.object),
        );
        break;
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired': {
        const order = await this.prisma.order.findUnique({
          where: { stripeSessionId: event.data.object.id },
          select: { id: true },
        });
        if (order) await this.expireOrder(order.id);
        break;
      }
      default:
        break;
    }
  }

  /** Idempotent: only the first call for a session flips it to PAID. */
  async markPaid(sessionId: string, stripePaymentIntentId?: string) {
    const { count } = await this.prisma.order.updateMany({
      where: { stripeSessionId: sessionId, status: 'PENDING_PAYMENT' },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        ...(stripePaymentIntentId && { stripePaymentIntentId }),
      },
    });
    if (count === 0) return;

    // Webhook context has no user; read the (RLS-secured) company privileged.
    const order = await this.prisma.$asAdmin((tx) =>
      tx.order.findUniqueOrThrow({
        where: { stripeSessionId: sessionId },
        include: {
          items: { select: ITEM_SUMMARY_SELECT },
          company: { select: { name: true } },
        },
      }),
    );
    log(LogKey.ORDER_PAID, 'Order paid', {
      orderId: order.id,
      number: order.number,
    });

    if (order.companyId) await this.createCardsForOrder(order.id);

    const registerUrl = `${this.appUrl}/register?email=${encodeURIComponent(order.email)}&order=${order.number}`;
    const emailData = {
      number: order.number,
      customerName: order.customerName,
      items: order.items,
      totalCents: order.totalCents,
      currency: order.currency,
      linkedCompanyName: order.company?.name ?? null,
      appUrl: order.companyId ? `${this.appUrl}/app/orders` : registerUrl,
    };
    await this.email
      .sendOrderConfirmationEmail(order.email, emailData)
      .catch(() => undefined);
    if (this.ordersEmail) {
      await this.email
        .sendOrderNotificationEmail(this.ordersEmail, {
          ...emailData,
          email: order.email,
          adminPath: `/orders/${order.id}`,
        })
        .catch(() => undefined);
    }
  }

  /** Abandoned or failed checkout: close the order and free its stock. */
  private async expireOrder(orderId: string) {
    const { count } = await this.prisma.order.updateMany({
      where: { id: orderId, status: 'PENDING_PAYMENT' },
      data: { status: 'EXPIRED' },
    });
    if (count > 0) {
      log(LogKey.ORDER_EXPIRED, 'Order expired', { orderId });
      await this.releaseStock(orderId);
    }
  }

  /** Give an order's units back to stock, at most once. */
  private async releaseStock(orderId: string) {
    const { count } = await this.prisma.order.updateMany({
      where: { id: orderId, stockReleasedAt: null },
      data: { stockReleasedAt: new Date() },
    });
    if (count === 0) return;
    const items = await this.prisma.orderItem.findMany({ where: { orderId } });
    await this.releaseReserved(
      items.map((i) => ({ key: i.productKey, quantity: i.quantity })),
    );
  }

  // ─── Guest status (website success page) ────────────────────────────────────

  async getBySession(sessionId: string) {
    const order = await this.prisma.order.findUnique({
      where: { stripeSessionId: sessionId },
      include: {
        items: {
          select: { productKey: true, productName: true, quantity: true },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return {
      number: order.number,
      status: order.status,
      email: order.email,
      totalCents: order.totalCents,
      currency: order.currency,
      items: order.items,
      claimed: order.companyId !== null,
    };
  }

  // ─── Company (app) ──────────────────────────────────────────────────────────

  async listForCompany(companyId: string, userId: string) {
    await this.access.requireMember(userId, companyId);
    const orders = await this.prisma.order.findMany({
      where: { companyId, status: { not: 'EXPIRED' } },
      include: ORDER_SUMMARY_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return orders.map(toSummary);
  }

  async claimable(companyId: string, user: User) {
    await this.access.requireMember(user.id, companyId);
    const orders = await this.findClaimable(user);
    return orders.map(toSummary);
  }

  async claim(companyId: string, user: User) {
    await this.access.requireManager(user.id, companyId);
    const orders = await this.findClaimable(user);
    return {
      claimed: await this.claimOrders(
        orders.map((o) => o.id),
        companyId,
        user.id,
      ),
    };
  }

  /**
   * Called when a user creates a company: link their paid guest orders to it.
   * Never throws, so an order problem can't block onboarding.
   */
  async claimForNewCompany(userId: string, companyId: string) {
    try {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) return;
      const orders = await this.findClaimable(user);
      if (orders.length > 0)
        await this.claimOrders(
          orders.map((o) => o.id),
          companyId,
          userId,
        );
    } catch (err) {
      logError(
        LogKey.ORDER_WEBHOOK_ERROR,
        'Auto-claim on company creation failed',
        {
          companyId,
          err: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }

  /** Paid, unlinked orders placed with the user's verified email. */
  private findClaimable(user: User) {
    if (!user.emailVerified) return Promise.resolve([] as OrderSummaryRow[]);
    return this.prisma.order.findMany({
      where: {
        companyId: null,
        status: { in: CLAIMABLE_STATUSES },
        email: { equals: user.email, mode: 'insensitive' },
      },
      include: ORDER_SUMMARY_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  private async claimOrders(
    orderIds: string[],
    companyId: string,
    userId: string,
  ) {
    let claimed = 0;
    for (const id of orderIds) {
      const { count } = await this.prisma.order.updateMany({
        where: { id, companyId: null },
        data: { companyId, claimedAt: new Date() },
      });
      if (count === 0) continue;
      claimed++;
      log(LogKey.ORDER_CLAIMED, 'Order linked to company', {
        orderId: id,
        companyId,
        userId,
      });
      await this.createCardsForOrder(id);
      await this.assignHandlerAsRep(id);
    }
    return claimed;
  }

  /**
   * Pre-create one Card per physical card so the customer can point them at a
   * page right away and production knows which slug goes on which chip.
   * Idempotent: does nothing if the order already has cards.
   */
  private async createCardsForOrder(orderId: string) {
    await this.prisma.$asAdmin(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: true, _count: { select: { cards: true } } },
      });
      if (!order.companyId || order._count.cards > 0) return;
      if (!CLAIMABLE_STATUSES.includes(order.status)) return;

      const rows: Prisma.CardCreateManyInput[] = [];
      // Card lists sort newest first. Step createdAt back 1 ms per card so an
      // order's cards read #1, #2, ... from the top instead of in random order.
      const base = Date.now();
      for (const item of order.items) {
        const design = (item.design ?? {}) as Record<string, unknown>;
        for (let i = 1; i <= item.quantity; i++) {
          rows.push({
            companyId: order.companyId,
            orderId: order.id,
            name: `${item.productName} ${order.number} #${i}`,
            type: CARD_TYPE_FOR_PRODUCT[item.productKey] ?? 'REVIEW',
            slug: '',
            status: 'UNASSIGNED',
            createdAt: new Date(base - rows.length),
            design: {
              orderNumber: order.number,
              productKey: item.productKey,
              ...(typeof design.finish === 'string' && {
                finish: design.finish,
              }),
            },
          });
        }
      }

      // Assign slugs unique in the company, regenerating the (rare) clashes.
      const slugs = new Set<string>();
      while (slugs.size < rows.length) slugs.add(cardSlug());
      let pending = [...slugs];
      for (let attempt = 0; attempt < 5; attempt++) {
        const taken = await tx.card.findMany({
          where: { companyId: order.companyId, slug: { in: pending } },
          select: { slug: true },
        });
        if (taken.length === 0) break;
        const takenSet = new Set(taken.map((t) => t.slug));
        pending = pending.map((s) => {
          if (!takenSet.has(s)) return s;
          let next = cardSlug();
          while (slugs.has(next)) next = cardSlug();
          slugs.add(next);
          return next;
        });
      }
      rows.forEach((row, i) => (row.slug = pending[i]));

      await tx.card.createMany({ data: rows });
      log(LogKey.ORDER_CARDS_CREATED, 'Cards created for order', {
        orderId,
        companyId: order.companyId,
        count: rows.length,
      });
    });
  }

  // ─── Admin ──────────────────────────────────────────────────────────────────

  async adminList(staff: User, query: ListOrdersQueryDto) {
    const q = query.q?.trim();
    // Company is RLS-secured and staff aren't members; read it privileged.
    const orders = await this.prisma.$asAdmin((tx) =>
      tx.order.findMany({
        where: {
          ...(query.handler === 'me' && { handledById: staff.id }),
          ...(query.handler === 'none' && { handledById: null }),
          ...(query.status
            ? { status: query.status as OrderStatus }
            : { status: { not: 'EXPIRED' } }),
          ...(q && {
            OR: [
              { number: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              { customerName: { contains: q, mode: 'insensitive' } },
              { companyName: { contains: q, mode: 'insensitive' } },
            ],
          }),
        },
        include: {
          ...ORDER_SUMMARY_INCLUDE,
          company: { select: { id: true, name: true } },
          handledBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
    return orders.map((o) => ({
      ...toSummary(o),
      companyId: o.companyId,
      companyNameInApp: o.company?.name ?? null,
      handledBy: o.handledBy,
      handledAt: o.handledAt,
    }));
  }

  async adminDetail(orderId: string) {
    // Cards are RLS-secured; staff read them through the privileged client.
    return this.prisma.$asAdmin(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: { orderBy: { createdAt: 'asc' } },
          company: {
            select: {
              id: true,
              name: true,
              slug: true,
              salesRep: { select: { id: true, name: true } },
            },
          },
          handledBy: { select: { id: true, name: true } },
          cards: {
            select: { id: true, slug: true, name: true },
            orderBy: { name: 'asc' },
          },
          _count: { select: { cards: true } },
        },
      });
      if (!order) throw new NotFoundException('Order not found');
      return {
        ...toSummary(order),
        phone: order.phone,
        shippingAddress: order.shippingAddress,
        locale: order.locale,
        trackingNumber: order.trackingNumber,
        stripeSessionId: order.stripeSessionId,
        stripePaymentIntentId: order.stripePaymentIntentId,
        claimedAt: order.claimedAt,
        cancelledAt: order.cancelledAt,
        companyId: order.companyId,
        companyNameInApp: order.company?.name ?? null,
        // Card links are /c/<company slug>/<card slug>.
        companySlug: order.company?.slug ?? null,
        salesRep: order.company?.salesRep ?? null,
        handledBy: order.handledBy,
        handledAt: order.handledAt,
        items: order.items,
        cards: order.cards,
      };
    });
  }

  async adminUpdateStatus(
    staff: User,
    orderId: string,
    dto: UpdateOrderStatusDto,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('Order not found');
    // Whoever claimed the order fulfils it; ADMIN+ may step in.
    if (
      order.handledById !== staff.id &&
      !platformRoleAtLeast(staff.platformRole, 'ADMIN')
    ) {
      throw new ForbiddenException(
        order.handledById
          ? 'Another team member is handling this order'
          : 'Claim the order before changing its status',
      );
    }

    const allowedFrom: Record<UpdateOrderStatusDto['status'], OrderStatus[]> = {
      IN_PRODUCTION: ['PAID'],
      SHIPPED: ['PAID', 'IN_PRODUCTION'],
      CANCELLED: ['PENDING_PAYMENT', 'PAID', 'IN_PRODUCTION'],
    };
    if (!allowedFrom[dto.status].includes(order.status)) {
      throw new ConflictException(
        `Cannot change a ${order.status} order to ${dto.status}`,
      );
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: dto.status,
        ...(dto.status === 'SHIPPED' && {
          shippedAt: new Date(),
          trackingNumber: dto.trackingNumber?.trim() || null,
        }),
        ...(dto.status === 'CANCELLED' && { cancelledAt: new Date() }),
      },
    });
    // Cancelled before shipping: the cards were never produced.
    if (dto.status === 'CANCELLED') await this.releaseStock(orderId);

    log(LogKey.ADMIN_ACTION, 'Admin: order.status', {
      action: 'order.status',
      staffId: staff.id,
      orderId,
      from: order.status,
      to: dto.status,
    });
    return this.adminDetail(orderId);
  }

  /**
   * A staff member takes an order: they fulfil it and become the sales rep of
   * its business. A business that already belongs to another rep is not taken
   * over; that rep (or an ADMIN, without changing the rep) handles it.
   */
  async adminClaim(staff: User, orderId: string) {
    const isAdmin = platformRoleAtLeast(staff.platformRole, 'ADMIN');
    await this.prisma.$asAdmin(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          company: {
            select: {
              id: true,
              salesRepId: true,
              salesRep: { select: { name: true } },
            },
          },
          handledBy: { select: { name: true } },
        },
      });
      if (!order) throw new NotFoundException('Order not found');
      if (order.status === 'EXPIRED' || order.status === 'CANCELLED') {
        throw new ConflictException(
          `A ${order.status} order cannot be claimed`,
        );
      }
      if (order.handledById === staff.id) return;
      if (order.handledById && !isAdmin) {
        throw new ConflictException(
          `${order.handledBy?.name || 'Another team member'} already claimed this order`,
        );
      }
      const rep = order.company?.salesRepId;
      if (rep && rep !== staff.id && !isAdmin) {
        throw new ConflictException(
          `This customer belongs to ${order.company?.salesRep?.name || 'another sales rep'}. Ask them or an admin to handle the order.`,
        );
      }

      await tx.order.update({
        where: { id: orderId },
        data: { handledById: staff.id, handledAt: new Date() },
      });
      if (order.company && !rep) {
        await tx.company.update({
          where: { id: order.company.id },
          data: { salesRepId: staff.id },
        });
      }
      log(LogKey.ADMIN_ACTION, 'Admin: order.claim', {
        action: 'order.claim',
        staffId: staff.id,
        orderId,
        previousHandlerId: order.handledById,
        becameSalesRep: Boolean(order.company && !rep),
      });
    });
    return this.adminDetail(orderId);
  }

  /**
   * A guest order linked to a business after a staff member claimed it: the
   * claimer becomes that business's sales rep, unless it already has one.
   */
  private async assignHandlerAsRep(orderId: string) {
    await this.prisma.$asAdmin(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { handledById: true, companyId: true },
      });
      if (!order?.handledById || !order.companyId) return;
      await tx.company.updateMany({
        where: { id: order.companyId, salesRepId: null },
        data: { salesRepId: order.handledById },
      });
    });
  }
}

function paymentIntentId(session: Stripe.Checkout.Session): string | undefined {
  const pi = session.payment_intent;
  if (!pi) return undefined;
  return typeof pi === 'string' ? pi : pi.id;
}

function toSummary(o: OrderSummaryRow) {
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    email: o.email,
    customerName: o.customerName,
    companyName: o.companyName,
    subtotalCents: o.subtotalCents,
    discountCents: o.discountCents,
    shippingCents: o.shippingCents,
    totalCents: o.totalCents,
    currency: o.currency,
    createdAt: o.createdAt,
    paidAt: o.paidAt,
    shippedAt: o.shippedAt,
    items: o.items,
    cardCount: o._count.cards,
  };
}
