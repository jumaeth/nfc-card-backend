import { Module } from '@nestjs/common';
import { ProductsService } from './products.service.js';
import {
  AdminProductsController,
  PublicProductsController,
} from './products.controller.js';

// PrismaModule and AuthModule are @Global, so their providers inject here.
@Module({
  controllers: [PublicProductsController, AdminProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
