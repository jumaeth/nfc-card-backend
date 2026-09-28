import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BillingService } from './billing.service.js';
import { ChangePlanDto, ConfirmCheckoutDto } from './dto/billing.dto.js';
import { BetterAuthGuard } from '../auth/auth.guard.js';
import { CompanyAccessService } from '../companies/company-access.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { hasPermission } from '../../common/permissions.js';
import type { User } from '../../../generated/prisma/client.js';

@ApiTags('billing')
@Controller()
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly access: CompanyAccessService,
  ) {}

  @ApiOperation({ summary: 'List the public subscription-plan catalogue' })
  @Get('billing/plans')
  listPlans() {
    return this.billing.listPlans();
  }

  @ApiOperation({ summary: "A company's subscription and resolved features" })
  @ApiBearerAuth()
  @UseGuards(BetterAuthGuard)
  @Get('companies/:companyId/billing')
  async getBilling(
    @Param('companyId') companyId: string,
    @CurrentUser() user: User,
  ) {
    const member = await this.access.requireMember(user.id, companyId);
    const [subscription, features, hasAccount] = await Promise.all([
      this.billing.getSubscription(companyId),
      this.billing.getCompanyFeatures(companyId),
      this.billing.hasBillingAccount(companyId),
    ]);
    return {
      subscription,
      features,
      // Pages are live and editable (plan or staff override). Otherwise they
      // are read-only in the app and offline to the public.
      pagesActive: await this.billing.pagesActive(companyId, features),
      billing: {
        online: this.billing.onlineBilling,
        simulated: this.billing.simulated,
        canManage: hasPermission(member, 'MANAGE_BILLING'),
        hasAccount,
      },
    };
  }

  @ApiOperation({
    summary:
      'Change plan: a Stripe Checkout or billing portal URL (MANAGE_BILLING)',
  })
  @ApiBearerAuth()
  @UseGuards(BetterAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('companies/:companyId/billing/change-plan')
  @HttpCode(200)
  async changePlan(
    @Param('companyId') companyId: string,
    @CurrentUser() user: User,
    @Body() dto: ChangePlanDto,
  ) {
    await this.requireBillingManager(user, companyId);
    return this.billing.startPlanChange(companyId, user, dto.tier);
  }

  @ApiOperation({
    summary: 'Apply a finished subscription checkout (MANAGE_BILLING)',
  })
  @ApiBearerAuth()
  @UseGuards(BetterAuthGuard)
  @Post('companies/:companyId/billing/confirm')
  @HttpCode(200)
  async confirm(
    @Param('companyId') companyId: string,
    @CurrentUser() user: User,
    @Body() dto: ConfirmCheckoutDto,
  ) {
    await this.requireBillingManager(user, companyId);
    return this.billing.confirmCheckout(companyId, dto.sessionId);
  }

  @ApiOperation({ summary: 'Stripe billing portal URL (MANAGE_BILLING)' })
  @ApiBearerAuth()
  @UseGuards(BetterAuthGuard)
  @Post('companies/:companyId/billing/portal')
  @HttpCode(200)
  async portal(
    @Param('companyId') companyId: string,
    @CurrentUser() user: User,
  ) {
    await this.requireBillingManager(user, companyId);
    return this.billing.portalUrl(companyId);
  }

  private async requireBillingManager(user: User, companyId: string) {
    const member = await this.access.requireMember(user.id, companyId);
    if (!hasPermission(member, 'MANAGE_BILLING')) {
      throw new ForbiddenException(
        'You need billing access to change the plan.',
      );
    }
  }
}
