import { Module } from '@nestjs/common';
import { CardsController } from './cards.controller.js';
import { CardsService } from './cards.service.js';
import { CompanyAccessModule } from '../companies/company-access.module.js';

@Module({
  imports: [CompanyAccessModule],
  controllers: [CardsController],
  providers: [CardsService],
})
export class CardsModule {}
