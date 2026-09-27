import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  type RawBodyRequest,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type Stripe from 'stripe';
import { OrdersService } from './orders.service.js';
import { StripeService } from './stripe.service.js';
import {
  CompanyOrderDto,
  GuestOrderDto,
  ListOrdersQueryDto,
  UpdateOrderStatusDto,
} from './dto/orders.dto.js';
import { BetterAuthGuard } from '../auth/auth.guard.js';
import { PlatformRoleGuard } from '../auth/platform-role.guard.js';
import { PlatformRoles } from '../auth/decorators/platform-roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { log, error as logError, LogKey } from '../../logger/index.js';
import type { User } from '../../../generated/prisma/client.js';

// Guest checkout from the marketing site. No account needed; the order is
// linked to an app account later by verified email.
@ApiTags('public')
@Controller('public')
export class PublicOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @ApiOperation({
    summary: 'Products, volume tiers and currency for the card designer',
  })
  @Get('shop')
  shop() {
    return this.orders.shopConfig();
  }

  @ApiOperation({
    summary: 'Place a guest order and get a Stripe Checkout URL',
  })
  // Guest orders arrive through the website's proxy, so every buyer shares its
  // address here. Global backstop; the website limits per visitor.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('orders')
  create(@Body() dto: GuestOrderDto) {
    return this.orders.createGuestOrder(dto);
  }

  @ApiOperation({ summary: 'Order status for the checkout success page' })
  @Get('orders/session/:sessionId')
  bySession(@Param('sessionId') sessionId: string) {
    return this.orders.getBySession(sessionId);
  }
}

@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(BetterAuthGuard)
@Controller('companies/:companyId/orders')
export class CompanyOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @ApiOperation({ summary: "The company's card orders" })
  @Get()
  list(@Param('companyId') companyId: string, @CurrentUser() user: User) {
    return this.orders.listForCompany(companyId, user.id);
  }

  @ApiOperation({
    summary: 'Order cards and get a Stripe Checkout URL (ADMIN+)',
  })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  create(
    @Param('companyId') companyId: string,
    @CurrentUser() user: User,
    @Body() dto: CompanyOrderDto,
  ) {
    return this.orders.createCompanyOrder(companyId, user, dto);
  }

  @ApiOperation({
    summary: "Paid website orders placed with the user's email, not linked yet",
  })
  @Get('claimable')
  claimable(@Param('companyId') companyId: string, @CurrentUser() user: User) {
    return this.orders.claimable(companyId, user);
  }

  @ApiOperation({
    summary: 'Link claimable orders to this company and create their cards',
  })
  @Post('claim')
  @HttpCode(200)
  claim(@Param('companyId') companyId: string, @CurrentUser() user: User) {
    return this.orders.claim(companyId, user);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(BetterAuthGuard, PlatformRoleGuard)
@PlatformRoles('SALES')
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @ApiOperation({ summary: 'Shop orders' })
  @Get()
  list(@CurrentUser() user: User, @Query() query: ListOrdersQueryDto) {
    return this.orders.adminList(user, query);
  }

  @ApiOperation({ summary: 'Order detail with designs and card slugs' })
  @Get(':orderId')
  detail(@Param('orderId') orderId: string) {
    return this.orders.adminDetail(orderId);
  }

  @ApiOperation({
    summary:
      'Claim an order: you fulfil it and become the sales rep of its business',
  })
  @Post(':orderId/claim')
  @HttpCode(200)
  claim(@CurrentUser() user: User, @Param('orderId') orderId: string) {
    return this.orders.adminClaim(user, orderId);
  }

  @ApiOperation({
    summary:
      'Move an order to production, shipped or cancelled (its claimer, or ADMIN+)',
  })
  @Patch(':orderId')
  update(
    @CurrentUser() user: User,
    @Param('orderId') orderId: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.orders.adminUpdateStatus(user, orderId, dto);
  }
}

@Controller('billing/stripe')
export class StripeWebhookController {
  constructor(
    private readonly orders: OrdersService,
    private readonly stripe: StripeService,
  ) {}

  @ApiExcludeEndpoint()
  @SkipThrottle()
  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    if (!req.rawBody || !signature)
      throw new BadRequestException('Missing signature');
    let event: Stripe.Event;
    try {
      event = this.stripe.constructEvent(req.rawBody, signature);
    } catch (err) {
      logError(LogKey.BILLING_WEBHOOK_ERROR, 'Stripe webhook rejected', {
        err: err instanceof Error ? err.message : String(err),
      });
      throw new BadRequestException('Invalid signature');
    }
    log(LogKey.BILLING_WEBHOOK_RECEIVED, 'Stripe webhook', {
      type: event.type,
      id: event.id,
    });
    // Errors propagate as 5xx so Stripe retries; handlers are idempotent.
    await this.orders.handleStripeEvent(event);
    return { received: true };
  }
}
