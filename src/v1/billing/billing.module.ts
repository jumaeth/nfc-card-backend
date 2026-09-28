import { Module } from '@nestjs/common';
import { BillingService } from './billing.service.js';
import { BillingController } from './billing.controller.js';
import { StripeService } from './stripe.service.js';
import { CompanyAccessModule } from '../companies/company-access.module.js';

@Module({
  imports: [CompanyAccessModule],
  providers: [BillingService, StripeService],
  controllers: [BillingController],
  exports: [BillingService, StripeService],
})
export class BillingModule {}
