import { Module } from '@nestjs/common';
import { CompanyAccessModule } from '../companies/company-access.module.js';
import { StorageService } from './storage.service.js';
import { UploadsService } from './uploads.service.js';
import { FilesController, UploadsController } from './uploads.controller.js';

@Module({
  imports: [CompanyAccessModule],
  providers: [StorageService, UploadsService],
  controllers: [UploadsController, FilesController],
  // The admin console uploads for customers through the same service.
  exports: [UploadsService],
})
export class UploadsModule {}
