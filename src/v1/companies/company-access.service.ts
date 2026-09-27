import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ROLE_RANK } from '../../common/permissions.js';
import type { CompanyMember, CompanyRole } from '../../../generated/prisma/client.js';

/**
 * Shared tenant-access helper used by every company-scoped module. RLS already
 * guarantees a user can only read/write rows of companies they belong to; these
 * checks turn that into clean 403/404 responses and enforce the role ladder
 * (OWNER > ADMIN > MEMBER) at the application layer.
 */
@Injectable()
export class CompanyAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Require that `userId` is an active member of `companyId`. Returns the member. */
  async requireMember(userId: string, companyId: string): Promise<CompanyMember> {
    const member = await this.prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!member || member.deactivatedAt || member.removedAt) {
      throw new ForbiddenException('You are not a member of this company');
    }
    return member;
  }

  /** Require that `userId` holds at least `minRole` in `companyId`. */
  async requireRole(
    userId: string,
    companyId: string,
    minRole: CompanyRole,
  ): Promise<CompanyMember> {
    const member = await this.requireMember(userId, companyId);
    if (ROLE_RANK[member.role] < ROLE_RANK[minRole]) {
      throw new ForbiddenException(`This action requires the ${minRole} role or higher`);
    }
    return member;
  }

  /** Convenience: require ADMIN or OWNER. */
  requireManager(userId: string, companyId: string): Promise<CompanyMember> {
    return this.requireRole(userId, companyId, 'ADMIN');
  }

  /** Load a company the user can access, or 404. */
  async requireCompany(userId: string, companyId: string) {
    await this.requireMember(userId, companyId);
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }
}
