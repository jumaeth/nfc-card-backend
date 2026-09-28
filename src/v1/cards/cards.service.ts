import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { destinationData } from './destination.js';
import { resolveCardSlug } from './card-slug.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { softDeleteCard } from '../../common/soft-delete.js';
import { CompanyAccessService } from '../companies/company-access.service.js';
import { log, LogKey } from '../../logger/index.js';
import { assertLocationWritable } from '../locations/read-only.js';
import { Prisma } from '../../../generated/prisma/client.js';
import type { CreateCardDto } from './dto/create-card.dto.js';
import type { UpdateCardDto } from './dto/update-card.dto.js';

// Public tap slug generator: 8 chars, lowercase alphanumeric.

const ACTIVE_PAGE_SELECT = {
  select: { id: true, name: true, kind: true, slug: true, published: true },
} as const;

const LOCATION_SELECT = {
  select: { id: true, name: true, readOnly: true },
} as const;

@Injectable()
export class CardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CompanyAccessService,
  ) {}

  /** List a company's cards, optionally filtered to one location. */
  async findAll(companyId: string, userId: string, locationId?: string) {
    await this.access.requireMember(userId, companyId);
    return this.prisma.card.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(locationId ? { locationId } : {}),
      },
      include: { activePage: ACTIVE_PAGE_SELECT, location: LOCATION_SELECT },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Create a new (unassigned) card. */
  async create(companyId: string, userId: string, dto: CreateCardDto) {
    await this.access.requireManager(userId, companyId);

    if (dto.locationId) {
      await this.assertLocationInCompany(dto.locationId, companyId);
    }

    const slug = await resolveCardSlug(this.prisma, companyId, {
      requested: dto.slug,
      name: dto.name,
    });

    const card = await this.prisma.card.create({
      data: {
        companyId,
        name: dto.name,
        type: dto.type,
        locationId: dto.locationId ?? null,
        area: dto.area?.trim() || null,
        slug,
        uid: dto.uid ?? null,
        status: 'UNASSIGNED',
        design: (dto.design ?? {}) as Prisma.InputJsonValue,
      },
      include: { activePage: ACTIVE_PAGE_SELECT, location: LOCATION_SELECT },
    });

    log(LogKey.CARD_CREATED, 'Card created', {
      cardId: card.id,
      companyId,
      type: card.type,
      slug: card.slug,
    });

    return card;
  }

  /** Load a single card scoped to the company. */
  async findOne(id: string, companyId: string, userId: string) {
    await this.access.requireMember(userId, companyId);
    return this.requireCard(id, companyId, {
      include: { activePage: true, location: true },
    });
  }

  /** Update card metadata. */
  async update(
    id: string,
    companyId: string,
    userId: string,
    dto: UpdateCardDto,
  ) {
    await this.access.requireManager(userId, companyId);
    await this.requireWritableCard(id, companyId);

    if (dto.locationId) {
      await this.assertLocationInCompany(dto.locationId, companyId);
    }

    const data: Prisma.CardUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.area !== undefined) data.area = dto.area?.trim() || null;
    if (dto.design !== undefined)
      data.design = dto.design as Prisma.InputJsonValue;
    // locationId: a string reassigns, an explicit null detaches.
    if (dto.locationId !== undefined) {
      data.location = dto.locationId
        ? { connect: { id: dto.locationId } }
        : { disconnect: true };
    }

    return this.prisma.card.update({
      where: { id },
      data,
      include: { activePage: ACTIVE_PAGE_SELECT, location: LOCATION_SELECT },
    });
  }

  /** Point (or clear) the card's tap destination. */
  async setDestination(
    id: string,
    companyId: string,
    userId: string,
    target: { pageId?: string | null; url?: string | null },
  ) {
    await this.access.requireManager(userId, companyId);
    await this.requireWritableCard(id, companyId);

    const data = await destinationData(this.prisma, companyId, target);
    const card = await this.prisma.card.update({
      where: { id },
      data,
      include: { activePage: true, location: LOCATION_SELECT },
    });

    log(
      LogKey.CARD_LINKED,
      data.status === 'ACTIVE'
        ? 'Card destination set'
        : 'Card destination cleared',
      {
        cardId: card.id,
        companyId,
        pageId: data.activePageId,
        link: !!data.linkUrl,
      },
    );

    return card;
  }

  /** Delete a card. */
  async remove(id: string, companyId: string, userId: string) {
    await this.access.requireManager(userId, companyId);
    await this.requireWritableCard(id, companyId);
    await this.prisma.$transaction((tx) => softDeleteCard(tx, id));
    return { id, deleted: true };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /** Load a card and assert it belongs to the company (404 / 403). */
  private async requireCard(
    id: string,
    companyId: string,
    args?: { include?: Prisma.CardInclude },
  ) {
    const card = await this.prisma.card.findUnique({
      where: { id },
      ...(args?.include ? { include: args.include } : {}),
    });
    if (!card || card.deletedAt) throw new NotFoundException('Card not found');
    if (card.companyId !== companyId) {
      throw new ForbiddenException('This card belongs to another company');
    }
    return card;
  }

  /** A card that may be changed: not on a read-only location. */
  private async requireWritableCard(id: string, companyId: string) {
    const card = await this.requireCard(id, companyId);
    if (card.locationId) {
      assertLocationWritable(
        await this.prisma.location.findUnique({
          where: { id: card.locationId },
          select: { readOnly: true },
        }),
      );
    }
    return card;
  }

  /** Verify a location exists within the company and can take cards. */
  private async assertLocationInCompany(locationId: string, companyId: string) {
    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
      select: { id: true, companyId: true, deletedAt: true, readOnly: true },
    });
    if (!location || location.deletedAt || location.companyId !== companyId) {
      throw new BadRequestException('Location does not belong to this company');
    }
    assertLocationWritable(location);
  }
}
