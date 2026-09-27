import { Module } from '@nestjs/common';
import { TranslateService } from './translate.service.js';
import { TranslateController } from './translate.controller.js';
import { CompanyAccessModule } from '../companies/company-access.module.js';

@Module({
  imports: [CompanyAccessModule],
  providers: [TranslateService],
  controllers: [TranslateController],
  // The admin console translates customer pages through the same service.
  exports: [TranslateService],
})
export class TranslateModule {}
