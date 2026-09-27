import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CompanyAccessService } from '../companies/company-access.service.js';

/** The business side: who asked for the Wi-Fi on a page, for export and erasure. */
@Injectable()
export class WifiGuestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CompanyAccessService,
  ) {}

  async list(companyId: string, pageId: string, userId: string) {
    await this.access.requireMember(userId, companyId);
    return this.prisma.wifiGuest.findMany({
      where: { companyId, pageId },
      orderBy: { lastSeenAt: 'desc' },
      take: 5000,
      select: {
        id: true,
        email: true,
        locale: true,
        verified: true,
        marketingConsent: true,
        consentAt: true,
        visits: true,
        lastSeenAt: true,
        createdAt: true,
      },
    });
  }

  /** Erasure request (or cleanup). Deletes the guest and their consent. */
  async remove(
    companyId: string,
    pageId: string,
    guestId: string,
    userId: string,
  ) {
    await this.access.requireManager(userId, companyId);
    const { count } = await this.prisma.wifiGuest.deleteMany({
      where: { id: guestId, companyId, pageId },
    });
    if (count === 0) throw new NotFoundException('Guest not found');
    return { id: guestId };
  }
}
