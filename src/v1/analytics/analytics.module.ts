import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.js';
import { AnalyticsController } from './analytics.controller.js';
import { CompanyAccessModule } from '../companies/company-access.module.js';
import { BillingModule } from '../billing/billing.module.js';

@Module({
  imports: [CompanyAccessModule, BillingModule],
  providers: [AnalyticsService],
  controllers: [AnalyticsController],
})
export class AnalyticsModule {}
