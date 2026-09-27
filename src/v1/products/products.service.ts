import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Product, User } from '../../../generated/prisma/client.js';
import { log, LogKey } from '../../logger/index.js';
import type { UpdateProductDto } from './dto/products.dto.js';

/** What the marketing site sees. `stock` is null when unlimited. */
export interface PublicProduct {
  key: string;
  name: string;
  priceCents: number;
  stock: number | null;
  available: boolean;
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  private toPublic(p: Product): PublicProduct {
    return {
      key: p.key,
      name: p.name,
      priceCents: p.priceCents,
      stock: p.stock,
      available: p.active && (p.stock === null || p.stock > 0),
    };
  }

  async listPublic(): Promise<PublicProduct[]> {
    const products = await this.prisma.product.findMany({
      orderBy: { key: 'asc' },
    });
    return products.map((p) => this.toPublic(p));
  }

  listAll() {
    return this.prisma.product.findMany({ orderBy: { key: 'asc' } });
  }

  /**
   * Take `quantity` units off the stock for a website order. Atomic: the
   * decrement only applies while enough stock is left, so two concurrent orders
   * can never oversell. Unlimited products (stock null) always succeed.
   */
  async reserve(key: string, quantity: number): Promise<PublicProduct> {
    const product = await this.prisma.product.findUnique({ where: { key } });
    if (!product) throw new NotFoundException('Product not found');
    if (!product.active)
      throw new ConflictException('Product is currently not available');
    if (product.stock === null) return this.toPublic(product);

    const { count } = await this.prisma.product.updateMany({
      where: { key, active: true, stock: { gte: quantity } },
      data: { stock: { decrement: quantity } },
    });
    if (count === 0)
      throw new ConflictException('Not enough stock for this order');

    const updated = await this.prisma.product.findUniqueOrThrow({
      where: { key },
    });
    log(LogKey.PRODUCT_STOCK_RESERVED, 'Product stock reserved', {
      key,
      quantity,
      stockLeft: updated.stock,
    });
    return this.toPublic(updated);
  }

  /** Give units back, e.g. when the order email failed after reserving. */
  async release(key: string, quantity: number): Promise<PublicProduct> {
    const product = await this.prisma.product.findUnique({ where: { key } });
    if (!product) throw new NotFoundException('Product not found');
    if (product.stock === null) return this.toPublic(product);

    const updated = await this.prisma.product.update({
      where: { key },
      data: { stock: { increment: quantity } },
    });
    log(LogKey.PRODUCT_STOCK_RELEASED, 'Product stock released', {
      key,
      quantity,
      stockLeft: updated.stock,
    });
    return this.toPublic(updated);
  }

  async update(staff: User, productId: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) throw new NotFoundException('Product not found');

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.priceCents !== undefined && { priceCents: dto.priceCents }),
        ...(dto.stock !== undefined && { stock: dto.stock }),
        ...(dto.active !== undefined && { active: dto.active }),
      },
    });
    log(LogKey.ADMIN_ACTION, 'Admin: product.update', {
      action: 'product.update',
      staffId: staff.id,
      productId,
      fields: Object.keys(dto),
    });
    return updated;
  }
}
