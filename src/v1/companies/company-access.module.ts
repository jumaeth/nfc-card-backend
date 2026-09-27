import { Module } from '@nestjs/common';
import { CompanyAccessService } from './company-access.service.js';

// Standalone so every company-scoped feature module can import the access
// helper without pulling in the whole CompaniesModule (avoids import cycles).
@Module({
  providers: [CompanyAccessService],
  exports: [CompanyAccessService],
})
export class CompanyAccessModule {}
