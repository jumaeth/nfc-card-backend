import { Module } from '@nestjs/common';
import { CompanyAccessModule } from '../companies/company-access.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { DesignTemplatesService } from './design-templates.service.js';
import { DesignTemplatesController } from './design-templates.controller.js';

@Module({
  imports: [CompanyAccessModule, BillingModule],
  providers: [DesignTemplatesService],
  controllers: [DesignTemplatesController],
  // The admin console manages customer designs through the same service.
  exports: [DesignTemplatesService],
})
export class DesignTemplatesModule {}
