import { Module } from '@nestjs/common';
import { CompaniesModule } from '../companies/companies.module.js';
import { TranslateModule } from '../translate/translate.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { DesignTemplatesModule } from '../design-templates/design-templates.module.js';
import { AdminController } from './admin.controller.js';
import { AdminCustomersController } from './admin-customers.controller.js';
import { AdminCustomersService } from './admin-customers.service.js';
import { AdminUsersService } from './admin-users.service.js';

@Module({
  imports: [CompaniesModule, TranslateModule, UploadsModule, DesignTemplatesModule],
  controllers: [AdminController, AdminCustomersController],
  providers: [AdminCustomersService, AdminUsersService],
})
export class AdminModule {}
