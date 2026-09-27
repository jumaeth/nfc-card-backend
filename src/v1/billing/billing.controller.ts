import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BillingService } from './billing.service.js';
import { BetterAuthGuard } from '../auth/auth.guard.js';
import { CompanyAccessService } from '../companies/company-access.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
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
  async getBilling(@Param('companyId') companyId: string, @CurrentUser() user: User) {
    await this.access.requireMember(user.id, companyId);
    const [subscription, features] = await Promise.all([
      this.billing.getSubscription(companyId),
      this.billing.getCompanyFeatures(companyId),
    ]);
    return { subscription, features };
  }
}
