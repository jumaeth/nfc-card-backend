import { Module } from '@nestjs/common';
import { PagesService } from './pages.service.js';
import { PagesController } from './pages.controller.js';
import { CompanyAccessModule } from '../companies/company-access.module.js';

@Module({
  imports: [CompanyAccessModule],
  providers: [PagesService],
  controllers: [PagesController],
})
export class PagesModule {}
