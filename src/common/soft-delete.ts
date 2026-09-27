import type { TxClient } from '../prisma/prisma.service.js';

/**
 * Soft deletes. Cards, pages and locations are flagged with `deletedAt` instead
 * of being removed, so tap history and audit trails keep their references. The
 * side effects the foreign keys used to apply on a hard delete are done here, so
 * the dashboard and the admin console behave the same.
 *
 * Every read of these tables must filter `deletedAt: null`. Slug and chip UID
 * lookups deliberately do not: a deleted card's printed URL is never reissued.
 */

/** Hide a card. Its taps stop resolving; its tap history stays. */
export function softDeleteCard(tx: TxClient, cardId: string) {
  return tx.card.update({
    where: { id: cardId },
    data: { deletedAt: new Date() },
  });
}

/** Hide and unpublish a page, and detach the cards that pointed at it. */
export async function softDeletePage(tx: TxClient, pageId: string) {
  await tx.card.updateMany({
    where: { activePageId: pageId, status: 'ACTIVE' },
    data: { activePageId: null, status: 'UNASSIGNED' },
  });
  await tx.card.updateMany({
    where: { activePageId: pageId },
    data: { activePageId: null },
  });
  return tx.page.update({
    where: { id: pageId },
    data: { deletedAt: new Date(), published: false },
  });
}

/** Hide a location and detach the cards and pages assigned to it. */
export async function softDeleteLocation(tx: TxClient, locationId: string) {
  await tx.card.updateMany({
    where: { locationId },
    data: { locationId: null },
  });
  await tx.page.updateMany({
    where: { locationId },
    data: { locationId: null },
  });
  return tx.location.update({
    where: { id: locationId },
    data: { deletedAt: new Date(), isDefault: false },
  });
}
