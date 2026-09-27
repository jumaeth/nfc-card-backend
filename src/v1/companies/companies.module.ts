import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module.js';
import { CompaniesService } from './companies.service.js';
import { CompaniesController } from './companies.controller.js';
import { InvitationsController } from './invitations.controller.js';
import { CompanyAccessModule } from './company-access.module.js';

@Module({
  imports: [CompanyAccessModule, OrdersModule],
  providers: [CompaniesService],
  controllers: [CompaniesController, InvitationsController],
  exports: [CompaniesService],
})
export class CompaniesModule {}
