import { Module } from '@nestjs/common';
import { CompanyAccessModule } from '../companies/company-access.module.js';
import { ProductsModule } from '../products/products.module.js';
import { OrdersService } from './orders.service.js';
import { StripeService } from './stripe.service.js';
import {
  AdminOrdersController,
  CompanyOrdersController,
  PublicOrdersController,
  StripeWebhookController,
} from './orders.controller.js';

// PrismaModule, AuthModule and EmailModule are @Global.
@Module({
  imports: [CompanyAccessModule, ProductsModule],
  controllers: [
    PublicOrdersController,
    CompanyOrdersController,
    AdminOrdersController,
    StripeWebhookController,
  ],
  providers: [OrdersService, StripeService],
  exports: [OrdersService],
})
export class OrdersModule {}
