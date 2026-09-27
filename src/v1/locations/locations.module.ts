import { Module } from '@nestjs/common';
import { LocationsService } from './locations.service.js';
import { LocationsController } from './locations.controller.js';
import { CompanyAccessModule } from '../companies/company-access.module.js';
import { BillingModule } from '../billing/billing.module.js';

@Module({
  imports: [CompanyAccessModule, BillingModule],
  providers: [LocationsService],
  controllers: [LocationsController],
})
export class LocationsModule {}
