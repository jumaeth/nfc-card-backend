import { BadRequestException, ConflictException } from '@nestjs/common';
import { customAlphabet } from 'nanoid';
import type { TxClient } from '../../prisma/prisma.service.js';

type Db = Pick<TxClient, 'card'>;

/** Random fallback for cards without a usable name (and for shop orders). */
export const randomCardSlug = customAlphabet(
  '0123456789abcdefghijklmnopqrstuvwxyz',
  8,
);

const MAX = 40;

/** "Tisch 12 (Terrasse)" -> "tisch-12-terrasse". Umlauts become ae/oe/ue. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX)
    .replace(/-+$/, '');
}

/**
 * The slug a new card gets inside its company (tap URL /c/<company>/<slug>).
 * A requested slug must be free in the company. Otherwise the card's name is
 * used ("tisch-1", then "tisch-1-2", ...), falling back to a random one.
 */
export async function resolveCardSlug(
  db: Db,
  companyId: string,
  input: { requested?: string; name?: string },
): Promise<string> {
  const taken = async (slug: string) =>
    !!(await db.card.findUnique({
      where: { companyId_slug: { companyId, slug } },
      select: { id: true },
    }));

  if (input.requested) {
    if (await taken(input.requested)) {
      throw new ConflictException(
        'This business already has a card with this link',
      );
    }
    return input.requested;
  }

  const base = slugify(input.name ?? '');
  if (base.length >= 1) {
    for (let n = 1; n <= 50; n++) {
      const suffix = n === 1 ? '' : `-${n}`;
      const candidate = `${base.slice(0, MAX - suffix.length)}${suffix}`;
      if (!(await taken(candidate))) return candidate;
    }
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = randomCardSlug();
    if (!(await taken(candidate))) return candidate;
  }
  throw new BadRequestException('Could not generate a card link, please retry');
}
