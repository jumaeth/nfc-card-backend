import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PRIVILEGED_ROLES, passkeyEnforcementEnabled } from '../../common/permissions.js';

/**
 * The bootstrap/discovery endpoint the app calls right after sign-in. Returns
 * the user, the companies they belong to (with their role), and passkey posture
 * so the client can decide whether to route through passkey setup/step-up. It is
 * `@SkipPasskeyGate()` so a privileged password session can learn it needs one.
 */
@Injectable()
export class AccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getAccess(userId: string) {
    const [user, memberships, passkeyCount] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true, emailVerified: true, avatarUrl: true, platformRole: true },
      }),
      this.prisma.companyMember.findMany({
        where: { userId, deactivatedAt: null, company: { deletedAt: null } },
        include: { company: { select: { id: true, name: true, slug: true, logo: true, brandColor: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.passkey.count({ where: { userId } }),
    ]);

    const companies = memberships.map((m) => ({ ...m.company, role: m.role }));
    const isPrivileged = memberships.some((m) => PRIVILEGED_ROLES.includes(m.role));
    const requiresPasskey = passkeyEnforcementEnabled(this.config) && isPrivileged;

    return {
      user,
      companies,
      requiresPasskey,
      hasPasskey: passkeyCount > 0,
    };
  }
}
