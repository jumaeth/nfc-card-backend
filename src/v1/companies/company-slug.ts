import { ConflictException } from '@nestjs/common';
import type { TxClient } from '../../prisma/prisma.service.js';

type Db = Pick<TxClient, 'company'>;

/**
 * A company slug is part of every printed card link (/c/<slug>/<card>), so it
 * stays reserved after a rename: taken means another company uses it now or
 * used it before. Needs a client that sees every company (not the RLS one).
 */
export async function assertCompanySlugFree(
  db: Db,
  slug: string,
  exceptCompanyId?: string,
) {
  const clash = await db.company.findFirst({
    where: {
      OR: [{ slug }, { previousSlugs: { has: slug } }],
      ...(exceptCompanyId && { id: { not: exceptCompanyId } }),
    },
    select: { id: true },
  });
  if (clash) throw new ConflictException('This short name is already taken');
}

/** Update data for a new slug: the old one keeps resolving for printed cards. */
export function renameSlugData(
  current: { slug: string; previousSlugs: string[] },
  next: string | undefined,
) {
  if (next === undefined || next === current.slug) return {};
  return {
    slug: next,
    previousSlugs: [
      ...new Set([...current.previousSlugs, current.slug]),
    ].filter((s) => s !== next),
  };
}
