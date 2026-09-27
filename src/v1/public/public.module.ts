import { Module } from '@nestjs/common';
import { PublicController } from './public.controller.js';
import { PublicService } from './public.service.js';

// PrismaModule is @Global, so PrismaService injects without importing it here.
@Module({
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
