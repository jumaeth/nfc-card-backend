import { BadRequestException } from '@nestjs/common';
import type { TxClient } from '../../prisma/prisma.service.js';

/**
 * The card fields for a new destination: one of the company's pages, a custom
 * link, or nothing (unassigned). Shared by the app and the admin console.
 */
export async function destinationData(
  db: Pick<TxClient, 'page'>,
  companyId: string,
  target: { pageId?: string | null; url?: string | null },
) {
  const pageId = target.pageId || null;
  const url = target.url?.trim() || null;
  if (pageId && url) {
    throw new BadRequestException('Choose a page or a link, not both');
  }
  if (pageId) {
    const page = await db.page.findUnique({
      where: { id: pageId },
      select: { companyId: true, deletedAt: true },
    });
    if (!page || page.deletedAt || page.companyId !== companyId) {
      throw new BadRequestException('Page does not belong to this company');
    }
  }
  return {
    activePageId: pageId,
    linkUrl: url,
    status: pageId || url ? ('ACTIVE' as const) : ('UNASSIGNED' as const),
  };
}
