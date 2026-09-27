import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService, type TxClient } from '../../prisma/prisma.service.js';
import { CompanyAccessService } from '../companies/company-access.service.js';

type Db = Pick<TxClient, 'wifiGuest'>;

/**
 * The business side: who asked for the Wi-Fi on a page, for export and
 * erasure. The public methods are the customer path (membership checks,
 * RLS-scoped client). The `*In` helpers take an already-authorized client so
 * the admin console can reuse them inside `$asAdmin`.
 */
@Injectable()
export class WifiGuestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CompanyAccessService,
  ) {}

  async list(companyId: string, pageId: string, userId: string) {
    await this.access.requireMember(userId, companyId);
    return this.listIn(this.prisma, companyId, pageId);
  }

  /** Erasure request (or cleanup). Deletes the guest and their consent. */
  async remove(
    companyId: string,
    pageId: string,
    guestId: string,
    userId: string,
  ) {
    await this.access.requireManager(userId, companyId);
    return this.removeIn(this.prisma, companyId, pageId, guestId);
  }

  listIn(db: Db, companyId: string, pageId: string) {
    return db.wifiGuest.findMany({
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

  async removeIn(db: Db, companyId: string, pageId: string, guestId: string) {
    const { count } = await db.wifiGuest.deleteMany({
      where: { id: guestId, companyId, pageId },
    });
    if (count === 0) throw new NotFoundException('Guest not found');
    return { id: guestId };
  }
}
