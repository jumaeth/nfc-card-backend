import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CompanyAccessService } from '../companies/company-access.service.js';
import { BillingService } from '../billing/billing.service.js';
import type { CreateLocationDto } from './dto/create-location.dto.js';
import type { UpdateLocationDto } from './dto/update-location.dto.js';

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CompanyAccessService,
    private readonly billing: BillingService,
  ) {}

  /** Every location of a company (any member may read them for the switcher). */
  async findAll(companyId: string, userId: string) {
    await this.access.requireMember(userId, companyId);
    return this.prisma.location.findMany({
      where: { companyId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  async create(companyId: string, userId: string, dto: CreateLocationDto) {
    await this.access.requireManager(userId, companyId);

    // The first location a company ever gets is always the default. Beyond that,
    // multiple locations are a Pro-plan feature gated by the subscription.
    const existingCount = await this.prisma.location.count({ where: { companyId } });

    if (existingCount >= 1) {
      const features = await this.billing.getCompanyFeatures(companyId);
      if (
        !features.multiLocation ||
        (features.maxLocations != null && existingCount >= features.maxLocations)
      ) {
        throw new ForbiddenException(
          'Your plan includes a single location. Upgrade to Pro to add more.',
        );
      }
    }

    const makeDefault = existingCount === 0 ? true : dto.isDefault ?? false;

    const data = {
      companyId,
      name: dto.name,
      isDefault: makeDefault,
      ...(dto.address !== undefined && { address: dto.address }),
      ...(dto.city !== undefined && { city: dto.city }),
      ...(dto.postalCode !== undefined && { postalCode: dto.postalCode }),
      ...(dto.country !== undefined && { country: dto.country }),
      ...(dto.timezone !== undefined && { timezone: dto.timezone }),
      ...(dto.googlePlaceId !== undefined && { googlePlaceId: dto.googlePlaceId }),
      ...(dto.googleReviewUrl !== undefined && { googleReviewUrl: dto.googleReviewUrl }),
    };

    // Promoting this location to default demotes the others in one transaction.
    if (makeDefault && existingCount > 0) {
      return this.prisma.$transaction(async (tx) => {
        await tx.location.updateMany({ where: { companyId }, data: { isDefault: false } });
        return tx.location.create({ data });
      });
    }

    return this.prisma.location.create({ data });
  }

  async findOne(id: string, companyId: string, userId: string) {
    await this.access.requireMember(userId, companyId);
    return this.requireLocation(id, companyId);
  }

  async update(id: string, companyId: string, userId: string, dto: UpdateLocationDto) {
    await this.access.requireManager(userId, companyId);
    await this.requireLocation(id, companyId);

    const data = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.address !== undefined && { address: dto.address }),
      ...(dto.city !== undefined && { city: dto.city }),
      ...(dto.postalCode !== undefined && { postalCode: dto.postalCode }),
      ...(dto.country !== undefined && { country: dto.country }),
      ...(dto.timezone !== undefined && { timezone: dto.timezone }),
      ...(dto.googlePlaceId !== undefined && { googlePlaceId: dto.googlePlaceId }),
      ...(dto.googleReviewUrl !== undefined && { googleReviewUrl: dto.googleReviewUrl }),
      ...(dto.isDefault === true && { isDefault: true }),
    };

    // Promoting a location to default demotes the others. Demoting the current
    // default directly is not allowed (a company always has exactly one).
    if (dto.isDefault === true) {
      return this.prisma.$transaction(async (tx) => {
        await tx.location.updateMany({ where: { companyId }, data: { isDefault: false } });
        return tx.location.update({ where: { id }, data });
      });
    }

    return this.prisma.location.update({ where: { id }, data });
  }

  async remove(id: string, companyId: string, userId: string) {
    await this.access.requireManager(userId, companyId);
    const location = await this.requireLocation(id, companyId);
    if (location.isDefault) {
      throw new BadRequestException('Set another location as default first.');
    }
    await this.prisma.location.delete({ where: { id } });
    return { id };
  }

  private async requireLocation(id: string, companyId: string) {
    const location = await this.prisma.location.findUnique({ where: { id } });
    if (!location) throw new NotFoundException('Location not found');
    if (location.companyId !== companyId) throw new ForbiddenException();
    return location;
  }
}
