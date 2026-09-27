import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  canManageCustomer,
  platformRoleAtLeast,
  seesAllCustomers,
  STAFF_PLATFORM_ROLES,
} from '../../common/permissions.js';
import { log, LogKey } from '../../logger/index.js';
import { Prisma } from '../../../generated/prisma/client.js';
import type { PlatformRole } from '../../../generated/prisma/client.js';
import type { Staff } from './admin-customers.service.js';
import type { ListUsersQueryDto } from './dto/users.dto.js';
import type { UpdatePlanDto } from './dto/plans.dto.js';

/**
 * Platform-wide users, staff roles and the plan catalogue. User and
 * SubscriptionPlan are not row-level secured; membership lookups that join into
 * tenant tables run under `$asAdmin` (the routes are SUPPORT+ or ADMIN+).
 */
@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** The signed-in staff member and what the console should offer them. */
  me(staff: Staff & { email: string }) {
    const role = staff.platformRole;
    return {
      user: { id: staff.id, name: staff.name, email: staff.email, platformRole: role },
      capabilities: {
        seesAllCustomers: seesAllCustomers(role),
        createsCustomers: role !== 'SUPPORT',
        managesAllCustomers: canManageCustomer(
          { id: staff.id, platformRole: role },
          { salesRepId: null },
        ),
        viewsUsers: platformRoleAtLeast(role, 'SUPPORT'),
        managesUsers: platformRoleAtLeast(role, 'ADMIN'),
        managesPlans: platformRoleAtLeast(role, 'ADMIN'),
        // Every staff role sees and can claim orders; ADMIN+ can take over.
        managesOrders: platformRoleAtLeast(role, 'SALES'),
        overridesOrders: platformRoleAtLeast(role, 'ADMIN'),
        assignsSalesReps: platformRoleAtLeast(role, 'ADMIN'),
        restoresDeleted: platformRoleAtLeast(role, 'SUPER_ADMIN'),
      },
    };
  }

  async list(query: ListUsersQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const q = query.q?.trim();
    const where: Prisma.UserWhereInput = {
      ...(q && {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      }),
      ...(query.role === 'STAFF'
        ? { platformRole: { in: STAFF_PLATFORM_ROLES } }
        : query.role && { platformRole: query.role }),
    };

    return this.prisma.$asAdmin(async (tx) => {
      const [items, total] = await Promise.all([
        tx.user.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            name: true,
            email: true,
            emailVerified: true,
            avatarUrl: true,
            platformRole: true,
            deletedAt: true,
            createdAt: true,
            _count: {
              select: { companyMembers: { where: { removedAt: null } }, salesCustomers: true },
            },
          },
        }),
        tx.user.count({ where }),
      ]);
      return { items, total, page, pageSize };
    });
  }

  detail(userId: string) {
    return this.prisma.$asAdmin(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          emailVerified: true,
          avatarUrl: true,
          platformRole: true,
          deletedAt: true,
          createdAt: true,
          companyMembers: {
            where: { removedAt: null },
            include: { company: { select: { id: true, name: true, slug: true, deletedAt: true } } },
            orderBy: { createdAt: 'asc' },
          },
          salesCustomers: {
            where: { deletedAt: null },
            select: { id: true, name: true, slug: true },
            orderBy: { name: 'asc' },
          },
          _count: { select: { passkeys: true, sessions: true } },
        },
      });
      if (!user) throw new NotFoundException('User not found');
      return user;
    });
  }

  /**
   * ADMIN+ (enforced on the route). Nobody changes their own role, and only a
   * SUPER_ADMIN may grant, revoke or edit SUPER_ADMIN.
   */
  async setRole(staff: Staff, userId: string, role: PlatformRole) {
    if (userId === staff.id) throw new BadRequestException('You cannot change your own role');

    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new NotFoundException('User not found');

    const touchesSuper = role === 'SUPER_ADMIN' || target.platformRole === 'SUPER_ADMIN';
    if (touchesSuper && staff.platformRole !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only a super admin can change super admin access');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { platformRole: role },
      select: { id: true, platformRole: true },
    });

    // A rep who loses SALES keeps its assignments until an admin reassigns them;
    // report how many so the console can say so.
    const assignedCustomers =
      role === 'SALES'
        ? 0
        : await this.prisma.$asAdmin((tx) =>
            tx.company.count({ where: { salesRepId: userId, deletedAt: null } }),
          );

    log(LogKey.ADMIN_ACTION, 'Admin: user.set_role', {
      action: 'user.set_role',
      staffId: staff.id,
      userId,
      from: target.platformRole,
      to: role,
    });
    return { ...updated, assignedCustomers };
  }

  /** Active sales reps with their customer counts (for assignment + filters). */
  salesReps() {
    return this.prisma.$asAdmin((tx) =>
      tx.user.findMany({
        where: { platformRole: 'SALES', deletedAt: null },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          email: true,
          _count: { select: { salesCustomers: { where: { deletedAt: null } } } },
        },
      }),
    );
  }

  // ─── Plans ──────────────────────────────────────────────────────────────────

  listPlans() {
    // The subscriber count reaches into the RLS-secured Subscription table.
    return this.prisma.$asAdmin((tx) =>
      tx.subscriptionPlan.findMany({
        orderBy: { priceCents: 'asc' },
        include: { _count: { select: { subscriptions: true } } },
      }),
    );
  }

  async updatePlan(staff: Staff, planId: string, dto: UpdatePlanDto) {
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');

    const updated = await this.prisma.subscriptionPlan.update({
      where: { id: planId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.priceCents !== undefined && { priceCents: dto.priceCents }),
        ...(dto.stripePriceId !== undefined && { stripePriceId: dto.stripePriceId }),
        ...(dto.features !== undefined && {
          features: dto.features as Prisma.InputJsonValue,
        }),
      },
    });
    log(LogKey.ADMIN_ACTION, 'Admin: plan.update', {
      action: 'plan.update',
      staffId: staff.id,
      planId,
      fields: Object.keys(dto),
    });
    return updated;
  }
}
