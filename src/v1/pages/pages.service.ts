import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { customAlphabet } from 'nanoid';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CompanyAccessService } from '../companies/company-access.service.js';
import { BillingService } from '../billing/billing.service.js';
import { softDeletePage } from '../../common/soft-delete.js';
import { log, LogKey } from '../../logger/index.js';
import { Prisma } from '../../../generated/prisma/client.js';
import type { PageKind } from '../../../generated/prisma/client.js';
import type { CreatePageDto } from './dto/create-page.dto.js';
import type { UpdatePageDto } from './dto/update-page.dto.js';
import { assertLocationWritable } from '../locations/read-only.js';

/** Public slug generator: 8 chars of lowercase alphanumerics. */
const generateSlug = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);

/** Light projection for list views. */
const listSelect = {
  id: true,
  name: true,
  kind: true,
  slug: true,
  published: true,
  locationId: true,
  updatedAt: true,
} satisfies Prisma.PageSelect;

@Injectable()
export class PagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CompanyAccessService,
    private readonly billing: BillingService,
  ) {}

  /** List a company's pages, optionally filtered by kind and/or location. */
  async findAll(
    companyId: string,
    userId: string,
    filters: { kind?: PageKind; locationId?: string } = {},
  ) {
    await this.access.requireMember(userId, companyId);
    return this.prisma.page.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(filters.kind && { kind: filters.kind }),
        ...(filters.locationId && { locationId: filters.locationId }),
      },
      orderBy: { updatedAt: 'desc' },
      select: listSelect,
    });
  }

  async create(companyId: string, userId: string, dto: CreatePageDto) {
    await this.access.requireManager(userId, companyId);

    const features = await this.billing.getCompanyFeatures(companyId);
    if (!(await this.billing.pagesActive(companyId, features))) {
      const hint = await this.billing.upgradeHint(
        features,
        (f) => f.createPages,
        'to build your own',
      );
      throw new ForbiddenException(`Your plan does not include creating pages. ${hint}`);
    }

    if (dto.locationId) {
      assertLocationWritable(await this.requireLocationInCompany(dto.locationId, companyId));
    }

    const slug = await this.resolveSlug(dto.slug);

    return this.prisma.page.create({
      data: {
        companyId,
        kind: dto.kind,
        name: dto.name,
        slug,
        published: dto.published ?? false,
        content: (dto.content ?? {}) as Prisma.InputJsonValue,
        theme: (dto.theme ?? {}) as Prisma.InputJsonValue,
        ...(dto.locationId && { locationId: dto.locationId }),
      },
    });
  }

  async findOne(id: string, companyId: string, userId: string) {
    await this.access.requireMember(userId, companyId);
    return this.requirePage(id, companyId);
  }

  async update(id: string, companyId: string, userId: string, dto: UpdatePageDto) {
    await this.access.requireManager(userId, companyId);
    const page = await this.requireWritablePage(id, companyId);

    if (dto.locationId) {
      assertLocationWritable(await this.requireLocationInCompany(dto.locationId, companyId));
    }

    const data: Prisma.PageUpdateInput = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.content !== undefined && { content: dto.content as Prisma.InputJsonValue }),
      ...(dto.theme !== undefined && { theme: dto.theme as Prisma.InputJsonValue }),
      ...(dto.published !== undefined && { published: dto.published }),
    };

    // locationId can be reassigned or detached (null). Handle its relation explicitly.
    if (dto.locationId !== undefined) {
      data.location = dto.locationId
        ? { connect: { id: dto.locationId } }
        : { disconnect: true };
    }

    const updated = await this.prisma.page.update({ where: { id }, data });

    // Log the publish transition (false/unset -> true) only.
    if (dto.published === true && !page.published) {
      log(LogKey.PAGE_PUBLISHED, 'Page published', {
        pageId: updated.id,
        companyId,
        kind: updated.kind,
      });
    }

    return updated;
  }

  async remove(id: string, companyId: string, userId: string) {
    await this.access.requireManager(userId, companyId);
    await this.requireWritablePage(id, companyId);
    await this.prisma.$transaction((tx) => softDeletePage(tx, id));
    return { id };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /** Load a page and assert it belongs to the company. */
  private async requirePage(id: string, companyId: string) {
    const page = await this.prisma.page.findUnique({ where: { id } });
    if (!page || page.deletedAt) throw new NotFoundException('Page not found');
    if (page.companyId !== companyId) throw new ForbiddenException();
    return page;
  }

  /**
   * A page that may be changed: the company's pages are active (plan or staff
   * override) and it is not on a read-only location. Read-only pages are kept.
   */
  private async requireWritablePage(id: string, companyId: string) {
    const page = await this.requirePage(id, companyId);
    await this.billing.assertPagesActive(companyId);
    if (page.locationId) {
      assertLocationWritable(await this.requireLocationInCompany(page.locationId, companyId));
    }
    return page;
  }

  /** Assert a location exists and belongs to the company. */
  private async requireLocationInCompany(locationId: string, companyId: string) {
    const location = await this.prisma.location.findUnique({ where: { id: locationId } });
    if (!location || location.deletedAt || location.companyId !== companyId) {
      throw new NotFoundException('Location not found');
    }
    return location;
  }

  /**
   * Resolve a unique public slug. If the caller supplied one, use it (409 on
   * collision). Otherwise generate and retry until unique.
   */
  private async resolveSlug(requested?: string): Promise<string> {
    if (requested) {
      const clash = await this.prisma.page.findUnique({ where: { slug: requested } });
      if (clash) throw new ForbiddenException('This slug is already taken');
      return requested;
    }

    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = generateSlug();
      const clash = await this.prisma.page.findUnique({ where: { slug: candidate } });
      if (!clash) return candidate;
    }
    // Practically unreachable given the keyspace.
    throw new ForbiddenException('Could not allocate a unique slug, please retry');
  }
}
