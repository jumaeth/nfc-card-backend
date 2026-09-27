import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { AccessModule } from './access/access.module.js';
import { CompaniesModule } from './companies/companies.module.js';
import { LocationsModule } from './locations/locations.module.js';
import { CardsModule } from './cards/cards.module.js';
import { PagesModule } from './pages/pages.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { PublicModule } from './public/public.module.js';
import { BillingModule } from './billing/billing.module.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    AccessModule,
    CompaniesModule,
    LocationsModule,
    CardsModule,
    PagesModule,
    AnalyticsModule,
    PublicModule,
    BillingModule,
  ],
  controllers: [HealthController],
})
export class V1Module {}
