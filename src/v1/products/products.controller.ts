import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProductsService } from './products.service.js';
import { UpdateProductDto } from './dto/products.dto.js';
import { BetterAuthGuard } from '../auth/auth.guard.js';
import { PlatformRoleGuard } from '../auth/platform-role.guard.js';
import { PlatformRoles } from '../auth/decorators/platform-roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { User } from '../../../generated/prisma/client.js';

// Unauthenticated catalogue read for the marketing site. Stock is reserved by
// OrdersService when a checkout starts, not through a public endpoint.
@ApiTags('public')
@Controller('public/products')
export class PublicProductsController {
  constructor(private readonly products: ProductsService) {}

  @ApiOperation({
    summary: 'Card prices and availability for the marketing site',
  })
  @Get()
  list() {
    return this.products.listPublic();
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(BetterAuthGuard, PlatformRoleGuard)
@PlatformRoles('SALES')
@Controller('admin/products')
export class AdminProductsController {
  constructor(private readonly products: ProductsService) {}

  @ApiOperation({ summary: 'Product catalogue with stock' })
  @Get()
  list() {
    return this.products.listAll();
  }

  @ApiOperation({
    summary: 'Edit a product price, stock or availability (SUPER_ADMIN)',
  })
  @PlatformRoles('SUPER_ADMIN')
  @Patch(':productId')
  update(
    @CurrentUser() user: User,
    @Param('productId') productId: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(user, productId, dto);
  }
}
