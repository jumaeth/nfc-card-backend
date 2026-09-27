import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { customAlphabet } from 'nanoid';
import { PrismaService, type TxClient } from '../../prisma/prisma.service.js';
import { CompaniesService } from '../companies/companies.service.js';
import { bootstrapCompany } from '../companies/company-bootstrap.js';
import {
  canManageCustomer,
  platformRoleAtLeast,
  seesAllCustomers,
} from '../../common/permissions.js';
import { log, LogKey } from '../../logger/index.js';
import { softDeleteCard, softDeleteLocation, softDeletePage } from '../../common/soft-delete.js';
import { Prisma } from '../../../generated/prisma/client.js';
import type { User } from '../../../generated/prisma/client.js';
import type {
  CreateCustomerDto,
  ListCustomersQueryDto,
  UpdateCustomerDto,
} from './dto/customer.dto.js';
import type { SetSubscriptionDto } from './dto/subscription.dto.js';
import type { AdminInviteDto, AdminUpdateMemberDto } from './dto/members.dto.js';
import type { CreateCardDto } from '../cards/dto/create-card.dto.js';
import type { UpdateCardDto } from '../cards/dto/update-card.dto.js';
import type { CreatePageDto } from '../pages/dto/create-page.dto.js';
import type { UpdatePageDto } from '../pages/dto/update-page.dto.js';
import type { CreateLocationDto } from '../locations/dto/create-location.dto.js';
import type { UpdateLocationDto } from '../locations/dto/update-location.dto.js';

export type Staff = Pick<User, 'id' | 'name' | 'platformRole'>;

// Public tap and page slug generator, same shape as CardsService and PagesService.
const nanoSlug = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);

const OPEN_ENDED = new Date('9999-12-31');
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const USER_SELECT = { select: { id: true, name: true, email: true, avatarUrl: true } } as const;
const REP_SELECT = { select: { id: true, name: true, email: true } } as const;
// Soft-deleted rows and removed or archived members are hidden from every count.
const LIVE = { where: { deletedAt: null } } as const;
const ACTIVE_MEMBERS = { where: { deactivatedAt: null, removedAt: null } } as const;

const CARD_INCLUDE = {
  activePage: { select: { id: true, name: true, kind: true, slug: true, published: true } },
  location: { select: { id: true, name: true } },
} as const;

/** The optional location fields a create or update DTO actually sent. */
function locationData(dto: CreateLocationDto | UpdateLocationDto) {
  return {
    ...(dto.address !== undefined && { address: dto.address }),
    ...(dto.city !== undefined && { city: dto.city }),
    ...(dto.postalCode !== undefined && { postalCode: dto.postalCode }),
    ...(dto.country !== undefined && { country: dto.country }),
    ...(dto.timezone !== undefined && { timezone: dto.timezone }),
    ...(dto.googlePlaceId !== undefined && { googlePlaceId: dto.googlePlaceId }),
    ...(dto.googleReviewUrl !== undefined && { googleReviewUrl: dto.googleReviewUrl }),
  };
}

/**
 * The admin console's view of customers (companies) across tenants.
 *
 * Staff are not members of the companies they look after, so RLS would hide
 * everything. Every query here therefore runs under `$asAdmin` and is scoped
 * explicitly instead: `scopeWhere` limits SALES to its own customers, and every
 * write goes through `requireManageable` (ADMIN+ any customer, SALES its own,
 * SUPPORT read-only). Out-of-scope customers 404 so their existence is not leaked.
 */
@Injectable()
export class AdminCustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
  ) {}

  // ─── Scope ──────────────────────────────────────────────────────────────────

  scopeWhere(staff: Staff): Prisma.CompanyWhereInput {
    return seesAllCustomers(staff.platformRole) ? {} : { salesRepId: staff.id };
  }

  private async requireViewable(tx: TxClient, staff: Staff, companyId: string) {
    const company = await tx.company.findFirst({
      where: { id: companyId, ...this.scopeWhere(staff) },
    });
    if (!company) throw new NotFoundException('Customer not found');
    return company;
  }

  private async requireManageable(tx: TxClient, staff: Staff, companyId: string) {
    const company = await this.requireViewable(tx, staff, companyId);
    if (!canManageCustomer(staff, company)) {
      throw new ForbiddenException('Your role can view this customer but not change it');
    }
    return company;
  }

  private audit(staff: Staff, action: string, meta: Record<string, unknown>) {
    log(LogKey.ADMIN_ACTION, `Admin: ${action}`, { action, staffId: staff.id, ...meta });
  }

  // ─── Overview ───────────────────────────────────────────────────────────────

  overview(staff: Staff) {
    const scope = { ...this.scopeWhere(staff), deletedAt: null };
    const since = new Date(Date.now() - THIRTY_DAYS_MS);

    return this.prisma.$asAdmin(async (tx) => {
      const [customers, cards, activeCards, taps, members, byPlan, recent, unassigned] =
        await Promise.all([
          tx.company.count({ where: scope }),
          tx.card.count({ where: { company: scope, deletedAt: null } }),
          tx.card.count({ where: { company: scope, deletedAt: null, status: 'ACTIVE' } }),
          tx.tapEvent.count({ where: { company: scope, createdAt: { gte: since } } }),
          tx.companyMember.count({ where: { company: scope, ...ACTIVE_MEMBERS.where } }),
          tx.subscription.groupBy({
            by: ['planId'],
            where: { company: scope },
            _count: { _all: true },
          }),
          tx.company.findMany({
            where: scope,
            orderBy: { createdAt: 'desc' },
            take: 6,
            include: {
              subscription: { include: { plan: { select: { tier: true, name: true } } } },
              salesRep: REP_SELECT,
              _count: { select: { cards: LIVE, members: ACTIVE_MEMBERS } },
            },
          }),
          seesAllCustomers(staff.platformRole)
            ? tx.company.count({ where: { deletedAt: null, salesRepId: null } })
            : Promise.resolve(null),
        ]);

      const plans = await tx.subscriptionPlan.findMany({ orderBy: { priceCents: 'asc' } });
      const planCounts = plans.map((p) => ({
        tier: p.tier,
        name: p.name,
        count: byPlan.find((b) => b.planId === p.id)?._count._all ?? 0,
      }));

      return {
        customers,
        cards,
        activeCards,
        tapsLast30Days: taps,
        members,
        unassignedCustomers: unassigned,
        plans: planCounts,
        recentCustomers: recent,
      };
    });
  }

  // ─── Customers ──────────────────────────────────────────────────────────────

  list(staff: Staff, query: ListCustomersQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const q = query.q?.trim();

    const where: Prisma.CompanyWhereInput = {
      ...this.scopeWhere(staff),
      deletedAt: query.status === 'archived' ? { not: null } : null,
      ...(q && {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { slug: { contains: q, mode: 'insensitive' } },
          { billingEmail: { contains: q, mode: 'insensitive' } },
        ],
      }),
    };
    // Rep filter only means something to staff who see more than their own.
    if (query.salesRepId && seesAllCustomers(staff.platformRole)) {
      where.salesRepId = query.salesRepId === 'none' ? null : query.salesRepId;
    }

    return this.prisma.$asAdmin(async (tx) => {
      const [items, total] = await Promise.all([
        tx.company.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            subscription: { include: { plan: { select: { tier: true, name: true } } } },
            salesRep: REP_SELECT,
            _count: { select: { cards: LIVE, members: ACTIVE_MEMBERS, locations: LIVE } },
          },
        }),
        tx.company.count({ where }),
      ]);
      return { items, total, page, pageSize };
    });
  }

  async create(staff: Staff, dto: CreateCustomerDto) {
    // SUPPORT is read-only; SALES always owns what it creates.
    if (staff.platformRole === 'SUPPORT') {
      throw new ForbiddenException('Your role cannot create customers');
    }
    const isAdmin = platformRoleAtLeast(staff.platformRole, 'ADMIN');
    const salesRepId = isAdmin ? (dto.salesRepId ?? null) : staff.id;

    const company = await this.prisma.$asAdmin(async (tx) => {
      if (await tx.company.findUnique({ where: { slug: dto.slug } })) {
        throw new ConflictException('A company with this slug already exists');
      }
      if (salesRepId && salesRepId !== staff.id) await this.requireSalesRep(tx, salesRepId);

      const starter = await tx.subscriptionPlan.findUnique({ where: { tier: 'STARTER' } });
      if (!starter) throw new BadRequestException('Plans not seeded. Run pnpm db:seed');

      const created = await bootstrapCompany(tx, {
        name: dto.name,
        slug: dto.slug,
        starterPlanId: starter.id,
        salesRepId,
      });

      if (dto.ownerEmail) {
        await this.companies.issueInvitation(tx, {
          companyId: created.id,
          companyName: created.name,
          email: dto.ownerEmail.toLowerCase(),
          role: 'OWNER',
          invitedById: staff.id,
          inviterName: staff.name || 'Taplino',
        });
      }
      return created;
    });

    this.audit(staff, 'customer.create', { companyId: company.id, salesRepId });
    return company;
  }

  detail(staff: Staff, companyId: string) {
    const since = new Date(Date.now() - THIRTY_DAYS_MS);
    return this.prisma.$asAdmin(async (tx) => {
      const base = await this.requireViewable(tx, staff, companyId);
      const [company, taps] = await Promise.all([
        tx.company.findUniqueOrThrow({
          where: { id: companyId },
          include: {
            salesRep: REP_SELECT,
            subscription: { include: { plan: true } },
            settings: true,
            locations: {
              where: { deletedAt: null },
              orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
            },
            members: {
              ...ACTIVE_MEMBERS,
              include: { user: USER_SELECT },
              orderBy: { createdAt: 'asc' },
            },
            invitations: {
              where: { status: 'PENDING' },
              orderBy: { createdAt: 'desc' },
            },
            _count: { select: { cards: LIVE, pages: LIVE, locations: LIVE } },
          },
        }),
        tx.tapEvent.count({ where: { companyId, createdAt: { gte: since } } }),
      ]);
      return { ...company, tapsLast30Days: taps, canManage: canManageCustomer(staff, base) };
    });
  }

  async update(staff: Staff, companyId: string, dto: UpdateCustomerDto) {
    const updated = await this.prisma.$asAdmin(async (tx) => {
      await this.requireManageable(tx, staff, companyId);
      if (dto.slug) {
        const clash = await tx.company.findUnique({ where: { slug: dto.slug } });
        if (clash && clash.id !== companyId) {
          throw new ConflictException('This URL identifier is already taken');
        }
      }
      return tx.company.update({
        where: { id: companyId },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.slug !== undefined && { slug: dto.slug }),
          ...(dto.billingEmail !== undefined && { billingEmail: dto.billingEmail }),
          ...(dto.brandColor !== undefined && { brandColor: dto.brandColor }),
        },
      });
    });
    this.audit(staff, 'customer.update', { companyId, fields: Object.keys(dto) });
    return updated;
  }

  /** ADMIN+ only (enforced on the route). */
  async assignSalesRep(staff: Staff, companyId: string, salesRepId: string | null) {
    const updated = await this.prisma.$asAdmin(async (tx) => {
      await this.requireViewable(tx, staff, companyId);
      if (salesRepId) await this.requireSalesRep(tx, salesRepId);
      return tx.company.update({
        where: { id: companyId },
        data: { salesRepId },
        include: { salesRep: REP_SELECT },
      });
    });
    this.audit(staff, 'customer.assign_sales_rep', { companyId, salesRepId });
    return updated;
  }

  /** ADMIN+ only. Archived customers disappear from the app for their members. */
  async setArchived(staff: Staff, companyId: string, archived: boolean) {
    const updated = await this.prisma.$asAdmin(async (tx) => {
      await this.requireViewable(tx, staff, companyId);
      return tx.company.update({
        where: { id: companyId },
        data: { deletedAt: archived ? new Date() : null },
      });
    });
    this.audit(staff, archived ? 'customer.archive' : 'customer.restore', { companyId });
    return updated;
  }

  // ─── Subscription ───────────────────────────────────────────────────────────

  async setSubscription(staff: Staff, companyId: string, dto: SetSubscriptionDto) {
    const sub = await this.prisma.$asAdmin(async (tx) => {
      await this.requireManageable(tx, staff, companyId);
      const plan = await tx.subscriptionPlan.findUnique({ where: { tier: dto.tier } });
      if (!plan) throw new BadRequestException('Plan not found');

      const existing = await tx.subscription.findUnique({ where: { companyId } });
      if (existing?.source === 'STRIPE' && existing.stripeSubscriptionId) {
        throw new BadRequestException(
          'This subscription is billed through Stripe. Change it in Stripe instead.',
        );
      }

      const periodEnd = dto.currentPeriodEnd ? new Date(dto.currentPeriodEnd) : OPEN_ENDED;
      const planChanged = existing?.planId !== plan.id;
      const data = {
        planId: plan.id,
        status: dto.status,
        source: 'MANUAL' as const,
        interval: plan.interval,
        currentPeriodEnd: periodEnd,
        ...(planChanged && { currentPeriodStart: new Date() }),
      };
      return tx.subscription.upsert({
        where: { companyId },
        create: { companyId, ...data },
        update: data,
        include: { plan: true },
      });
    });
    this.audit(staff, 'customer.set_subscription', {
      companyId,
      tier: dto.tier,
      status: dto.status,
    });
    return sub;
  }

  // ─── Members & invitations ──────────────────────────────────────────────────

  async invite(staff: Staff, companyId: string, dto: AdminInviteDto) {
    const email = dto.email.toLowerCase();
    const invitation = await this.prisma.$asAdmin(async (tx) => {
      const company = await this.requireManageable(tx, staff, companyId);
      const member = await tx.companyMember.findFirst({
        where: {
          companyId,
          removedAt: null,
          user: { email: { equals: email, mode: 'insensitive' } },
        },
      });
      if (member) throw new ConflictException('This user is already a member of this company');
      const pending = await tx.invitation.findFirst({
        where: { companyId, email: { equals: email, mode: 'insensitive' }, status: 'PENDING' },
      });
      if (pending) {
        throw new ConflictException('An active invitation already exists for this email');
      }
      return this.companies.issueInvitation(tx, {
        companyId,
        companyName: company.name,
        email,
        role: dto.role,
        invitedById: staff.id,
        inviterName: staff.name || 'Taplino',
      });
    });
    this.audit(staff, 'customer.invite', { companyId, invitationId: invitation.id, role: dto.role });
    return invitation;
  }

  async cancelInvitation(staff: Staff, companyId: string, invitationId: string) {
    const result = await this.prisma.$asAdmin(async (tx) => {
      await this.requireManageable(tx, staff, companyId);
      const invitation = await tx.invitation.findUnique({ where: { id: invitationId } });
      if (!invitation || invitation.companyId !== companyId) {
        throw new NotFoundException('Invitation not found');
      }
      if (invitation.status !== 'PENDING') {
        throw new BadRequestException('Invitation is not pending');
      }
      return tx.invitation.update({ where: { id: invitationId }, data: { status: 'CANCELLED' } });
    });
    this.audit(staff, 'customer.cancel_invitation', { companyId, invitationId });
    return result;
  }

  async updateMember(
    staff: Staff,
    companyId: string,
    userId: string,
    dto: AdminUpdateMemberDto,
  ) {
    const member = await this.prisma.$asAdmin(async (tx) => {
      await this.requireManageable(tx, staff, companyId);
      const target = await this.requireMemberOf(tx, companyId, userId);
      if (target.role === 'OWNER' && dto.role !== 'OWNER') {
        await this.assertNotLastOwner(tx, companyId);
      }
      return tx.companyMember.update({
        where: { id: target.id },
        data: { role: dto.role },
        include: { user: USER_SELECT },
      });
    });
    this.audit(staff, 'customer.update_member', { companyId, userId, role: dto.role });
    return member;
  }

  async removeMember(staff: Staff, companyId: string, userId: string) {
    await this.prisma.$asAdmin(async (tx) => {
      await this.requireManageable(tx, staff, companyId);
      const target = await this.requireMemberOf(tx, companyId, userId);
      if (target.role === 'OWNER') await this.assertNotLastOwner(tx, companyId);
      // Soft delete: the row stays for history and an invitation reactivates it.
      await tx.companyMember.update({ where: { id: target.id }, data: { removedAt: new Date() } });
    });
    this.audit(staff, 'customer.remove_member', { companyId, userId });
    return { userId, removed: true };
  }

  // ─── Cards ──────────────────────────────────────────────────────────────────

  listCards(staff: Staff, companyId: string) {
    return this.prisma.$asAdmin(async (tx) => {
      await this.requireViewable(tx, staff, companyId);
      return tx.card.findMany({
        where: { companyId, deletedAt: null },
        include: CARD_INCLUDE,
        orderBy: { createdAt: 'desc' },
      });
    });
  }

  async createCard(staff: Staff, companyId: string, dto: CreateCardDto) {
    const card = await this.prisma.$asAdmin(async (tx) => {
      await this.requireManageable(tx, staff, companyId);
      if (dto.locationId) await this.assertLocationInCompany(tx, dto.locationId, companyId);
      if (dto.uid && (await tx.card.findUnique({ where: { uid: dto.uid } }))) {
        throw new ConflictException('A card with this chip UID already exists');
      }
      return tx.card.create({
        data: {
          companyId,
          name: dto.name,
          type: dto.type,
          locationId: dto.locationId ?? null,
          slug: await this.resolveCardSlug(tx, dto.slug),
          uid: dto.uid ?? null,
          status: 'UNASSIGNED',
          design: (dto.design ?? {}) as Prisma.InputJsonValue,
        },
        include: CARD_INCLUDE,
      });
    });
    this.audit(staff, 'card.create', { companyId, cardId: card.id, slug: card.slug });
    return card;
  }

  async updateCard(staff: Staff, companyId: string, cardId: string, dto: UpdateCardDto) {
    const card = await this.prisma.$asAdmin(async (tx) => {
      await this.requireManageable(tx, staff, companyId);
      await this.requireCard(tx, companyId, cardId);
      if (dto.locationId) await this.assertLocationInCompany(tx, dto.locationId, companyId);

      const data: Prisma.CardUpdateInput = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.status !== undefined) data.status = dto.status;
      if (dto.design !== undefined) data.design = dto.design as Prisma.InputJsonValue;
      if (dto.locationId !== undefined) {
        data.location = dto.locationId
          ? { connect: { id: dto.locationId } }
          : { disconnect: true };
      }
      return tx.card.update({ where: { id: cardId }, data, include: CARD_INCLUDE });
    });
    this.audit(staff, 'card.update', { companyId, cardId, fields: Object.keys(dto) });
    return card;
  }

  async setCardDestination(
    staff: Staff,
    companyId: string,
    cardId: string,
    pageId: string | null | undefined,
  ) {
    const card = await this.prisma.$asAdmin(async (tx) => {
      await this.requireManageable(tx, staff, companyId);
      await this.requireCard(tx, companyId, cardId);
      if (pageId) {
        const page = await tx.page.findUnique({ where: { id: pageId } });
        if (!page || page.deletedAt || page.companyId !== companyId) {
          throw new BadRequestException('Page does not belong to this company');
        }
      }
      return tx.card.update({
        where: { id: cardId },
        data: { activePageId: pageId || null, status: pageId ? 'ACTIVE' : 'UNASSIGNED' },
        include: CARD_INCLUDE,
      });
    });
    this.audit(staff, 'card.set_destination', { companyId, cardId, pageId: pageId ?? null });
    return card;
  }

  async deleteCard(staff: Staff, companyId: string, cardId: string) {
    await this.prisma.$asAdmin(async (tx) => {
      await this.requireManageable(tx, staff, companyId);
      await this.requireCard(tx, companyId, cardId);
      await softDeleteCard(tx, cardId);
    });
    this.audit(staff, 'card.delete', { companyId, cardId });
    return { id: cardId, deleted: true };
  }

  // ─── Locations ──────────────────────────────────────────────────────────────

  /**
   * Staff set customers up, so like createPage this deliberately skips the
   * plan's location limit. The default rules match LocationsService: the first
   * location is always the default, promoting one demotes the others, and the
   * current default can only change by promoting another location.
   */
  async createLocation(staff: Staff, companyId: string, dto: CreateLocationDto) {
    const location = await this.prisma.$asAdmin(async (tx) => {
      await this.requireManageable(tx, staff, companyId);
      const existing = await tx.location.count({ where: { companyId, deletedAt: null } });
      const isDefault = existing === 0 || dto.isDefault === true;
      if (isDefault && existing > 0) {
        await tx.location.updateMany({ where: { companyId }, data: { isDefault: false } });
      }
      return tx.location.create({
        data: { ...locationData(dto), companyId, name: dto.name, isDefault },
      });
    });
    this.audit(staff, 'location.create', { companyId, locationId: location.id });
    return location;
  }

  async updateLocation(
    staff: Staff,
    companyId: string,
    locationId: string,
    dto: UpdateLocationDto,
  ) {
    const location = await this.prisma.$asAdmin(async (tx) => {
      await this.requireManageable(tx, staff, companyId);
      await this.requireLocation(tx, companyId, locationId);
      if (dto.isDefault === true) {
        await tx.location.updateMany({ where: { companyId }, data: { isDefault: false } });
      }
      return tx.location.update({
        where: { id: locationId },
        data: {
          ...locationData(dto),
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.isDefault === true && { isDefault: true }),
        },
      });
    });
    this.audit(staff, 'location.update', { companyId, locationId, fields: Object.keys(dto) });
    return location;
  }

  async deleteLocation(staff: Staff, companyId: string, locationId: string) {
    await this.prisma.$asAdmin(async (tx) => {
      await this.requireManageable(tx, staff, companyId);
      const location = await this.requireLocation(tx, companyId, locationId);
      if (location.isDefault) {
        throw new BadRequestException('Set another location as default first.');
      }
      await softDeleteLocation(tx, locationId);
    });
    this.audit(staff, 'location.delete', { companyId, locationId });
    return { id: locationId, deleted: true };
  }

  // ─── Pages ──────────────────────────────────────────────────────────────────

  listPages(staff: Staff, companyId: string) {
    return this.prisma.$asAdmin(async (tx) => {
      await this.requireViewable(tx, staff, companyId);
      return tx.page.findMany({
        where: { companyId, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          name: true,
          kind: true,
          slug: true,
          published: true,
          updatedAt: true,
          location: { select: { id: true, name: true } },
          _count: { select: { cards: LIVE } },
        },
      });
    });
  }

  /**
   * Staff provision pages for customers whose plan does not let them create their
   * own (Starter), so this deliberately skips the `createPages` plan check.
   */
  async createPage(staff: Staff, companyId: string, dto: CreatePageDto) {
    const page = await this.prisma.$asAdmin(async (tx) => {
      await this.requireManageable(tx, staff, companyId);
      if (dto.locationId) await this.assertLocationInCompany(tx, dto.locationId, companyId);
      return tx.page.create({
        data: {
          companyId,
          kind: dto.kind,
          name: dto.name,
          slug: await this.resolvePageSlug(tx, dto.slug),
          published: dto.published ?? false,
          content: (dto.content ?? {}) as Prisma.InputJsonValue,
          theme: (dto.theme ?? {}) as Prisma.InputJsonValue,
          locationId: dto.locationId ?? null,
        },
        select: { id: true, name: true, kind: true, slug: true, published: true },
      });
    });
    this.audit(staff, 'page.create', { companyId, pageId: page.id, kind: page.kind });
    return page;
  }

  getPage(staff: Staff, companyId: string, pageId: string) {
    return this.prisma.$asAdmin(async (tx) => {
      await this.requireViewable(tx, staff, companyId);
      return this.requirePage(tx, companyId, pageId);
    });
  }

  /** Same fields as the customer-facing `PagesService.update`. */
  async updatePage(staff: Staff, companyId: string, pageId: string, dto: UpdatePageDto) {
    const page = await this.prisma.$asAdmin(async (tx) => {
      await this.requireManageable(tx, staff, companyId);
      await this.requirePage(tx, companyId, pageId);
      if (dto.locationId) await this.assertLocationInCompany(tx, dto.locationId, companyId);

      const data: Prisma.PageUpdateInput = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.published !== undefined) data.published = dto.published;
      if (dto.content !== undefined) data.content = dto.content as Prisma.InputJsonValue;
      if (dto.theme !== undefined) data.theme = dto.theme as Prisma.InputJsonValue;
      if (dto.locationId !== undefined) {
        data.location = dto.locationId
          ? { connect: { id: dto.locationId } }
          : { disconnect: true };
      }
      return tx.page.update({ where: { id: pageId }, data });
    });
    this.audit(staff, 'page.update', { companyId, pageId, fields: Object.keys(dto) });
    return page;
  }

  /** Soft delete: the page is unpublished and hidden, and its cards are detached. */
  async deletePage(staff: Staff, companyId: string, pageId: string) {
    await this.prisma.$asAdmin(async (tx) => {
      await this.requireManageable(tx, staff, companyId);
      await this.requirePage(tx, companyId, pageId);
      await softDeletePage(tx, pageId);
    });
    this.audit(staff, 'page.delete', { companyId, pageId });
    return { id: pageId, deleted: true };
  }

  // ─── Deleted pages (SUPER_ADMIN, enforced on the routes) ─────────────────────

  listDeletedPages(staff: Staff, companyId: string) {
    return this.prisma.$asAdmin(async (tx) => {
      await this.requireViewable(tx, staff, companyId);
      return tx.page.findMany({
        where: { companyId, deletedAt: { not: null } },
        orderBy: { deletedAt: 'desc' },
        select: { id: true, name: true, kind: true, slug: true, deletedAt: true },
      });
    });
  }

  /**
   * Bring a soft-deleted page back as an unpublished draft. Cards that pointed
   * at it were detached on delete and are not re-linked.
   */
  async restorePage(staff: Staff, companyId: string, pageId: string) {
    const page = await this.prisma.$asAdmin(async (tx) => {
      await this.requireViewable(tx, staff, companyId);
      const page = await tx.page.findUnique({ where: { id: pageId } });
      if (!page || page.companyId !== companyId || !page.deletedAt) {
        throw new NotFoundException('Deleted page not found');
      }
      return tx.page.update({
        where: { id: pageId },
        data: { deletedAt: null, published: false },
        select: { id: true, name: true, kind: true, slug: true, published: true },
      });
    });
    this.audit(staff, 'page.restore', { companyId, pageId });
    return page;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private async requireSalesRep(tx: TxClient, userId: string) {
    const rep = await tx.user.findUnique({ where: { id: userId } });
    if (!rep || rep.deletedAt || rep.platformRole !== 'SALES') {
      throw new BadRequestException('The selected user is not a sales rep');
    }
  }

  private async requireMemberOf(tx: TxClient, companyId: string, userId: string) {
    const member = await tx.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!member || member.removedAt) throw new NotFoundException('Member not found');
    return member;
  }

  private async assertNotLastOwner(tx: TxClient, companyId: string) {
    const owners = await tx.companyMember.count({
      where: { companyId, role: 'OWNER', ...ACTIVE_MEMBERS.where },
    });
    if (owners <= 1) {
      throw new BadRequestException('A company needs at least one owner. Promote someone first.');
    }
  }

  private async requirePage(tx: TxClient, companyId: string, pageId: string) {
    const page = await tx.page.findUnique({ where: { id: pageId } });
    if (!page || page.deletedAt || page.companyId !== companyId) {
      throw new NotFoundException('Page not found');
    }
    return page;
  }

  private async requireCard(tx: TxClient, companyId: string, cardId: string) {
    const card = await tx.card.findUnique({ where: { id: cardId } });
    if (!card || card.deletedAt || card.companyId !== companyId) {
      throw new NotFoundException('Card not found');
    }
    return card;
  }

  private async requireLocation(tx: TxClient, companyId: string, locationId: string) {
    const location = await tx.location.findUnique({ where: { id: locationId } });
    if (!location || location.deletedAt || location.companyId !== companyId) {
      throw new NotFoundException('Location not found');
    }
    return location;
  }

  private async assertLocationInCompany(tx: TxClient, locationId: string, companyId: string) {
    const location = await tx.location.findUnique({ where: { id: locationId } });
    if (!location || location.deletedAt || location.companyId !== companyId) {
      throw new BadRequestException('Location does not belong to this company');
    }
  }

  private async resolveCardSlug(tx: TxClient, requested?: string): Promise<string> {
    if (requested) {
      if (await tx.card.findUnique({ where: { slug: requested } })) {
        throw new ConflictException('Slug is already in use');
      }
      return requested;
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = nanoSlug();
      if (!(await tx.card.findUnique({ where: { slug: candidate } }))) return candidate;
    }
    throw new BadRequestException('Could not generate a unique slug, please retry');
  }

  private async resolvePageSlug(tx: TxClient, requested?: string): Promise<string> {
    if (requested) {
      if (await tx.page.findUnique({ where: { slug: requested } })) {
        throw new ConflictException('Slug is already in use');
      }
      return requested;
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = nanoSlug();
      if (!(await tx.page.findUnique({ where: { slug: candidate } }))) return candidate;
    }
    throw new BadRequestException('Could not generate a unique slug, please retry');
  }
}
