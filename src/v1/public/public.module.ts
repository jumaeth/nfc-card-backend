import { Module } from '@nestjs/common';
import { PublicController } from './public.controller.js';
import { PublicService } from './public.service.js';
import { BillingModule } from '../billing/billing.module.js';

// PrismaModule is @Global, so PrismaService injects without importing it here.
@Module({
  imports: [BillingModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
