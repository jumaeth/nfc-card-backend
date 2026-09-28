import { Module } from '@nestjs/common';
import { CompanyAccessModule } from '../companies/company-access.module.js';
import { ProductsModule } from '../products/products.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { OrdersService } from './orders.service.js';
import {
  AdminOrdersController,
  CompanyOrdersController,
  PublicOrdersController,
  StripeWebhookController,
} from './orders.controller.js';

// PrismaModule, AuthModule and EmailModule are @Global. BillingModule provides
// StripeService and the subscription side of the Stripe webhook.
@Module({
  imports: [CompanyAccessModule, ProductsModule, BillingModule],
  controllers: [
    PublicOrdersController,
    CompanyOrdersController,
    AdminOrdersController,
    StripeWebhookController,
  ],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
