import { Module } from '@nestjs/common';
import { PagesService } from './pages.service.js';
import { PagesController } from './pages.controller.js';
import { CompanyAccessModule } from '../companies/company-access.module.js';
import { BillingModule } from '../billing/billing.module.js';

@Module({
  imports: [CompanyAccessModule, BillingModule],
  providers: [PagesService],
  controllers: [PagesController],
})
export class PagesModule {}
