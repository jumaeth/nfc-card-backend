import { Module } from '@nestjs/common';
import { CompaniesService } from './companies.service.js';
import { CompaniesController } from './companies.controller.js';
import { InvitationsController } from './invitations.controller.js';
import { CompanyAccessModule } from './company-access.module.js';

@Module({
  imports: [CompanyAccessModule],
  providers: [CompaniesService],
  controllers: [CompaniesController, InvitationsController],
})
export class CompaniesModule {}
