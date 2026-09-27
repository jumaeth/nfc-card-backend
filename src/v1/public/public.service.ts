import { Injectable, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Page, PageKind, Prisma } from '../../../generated/prisma/client.js';
import { log, LogKey } from '../../logger/index.js';
import { publicWifiContent } from '../wifi/wifi-content.js';
import type { WifiContent } from '../wifi/wifi-content.js';

/**
 * A page as the public views get it. `companyName` names the business in the
 * Wi-Fi privacy note; gated Wi-Fi pages never include the password.
 */
function publicPage(page: Page, companyName: string) {
  return {
    id: page.id,
    kind: page.kind,
    name: page.name,
    theme: page.theme,
    content:
      page.kind === 'WIFI'
        ? publicWifiContent(page.content as WifiContent)
        : page.content,
    slug: page.slug,
    companyName,
  };
}

const CARD_TAP_INCLUDE = {
  activePage: true,
  company: { select: { name: true } },
} satisfies Prisma.CardInclude;

type TapCard = Prisma.CardGetPayload<{ include: typeof CARD_TAP_INCLUDE }>;

/** Arguments for a single analytics write. Any of card/page may be absent. */
interface RecordTapArgs {
  companyId: string;
  cardId?: string;
  pageId?: string;
  kind?: PageKind | null;
  req: Request;
}

@Injectable()
export class PublicService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Coarse device bucket from the User-Agent. No PII: just ios / android /
   * desktop, or null when the header is absent.
   */
  private deviceTypeFromUA(ua?: string): string | null {
    if (!ua) return null;
    if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
    if (/android/i.test(ua)) return 'android';
    return 'desktop';
  }

  /**
   * Best-effort analytics write for a public tap. Uses the raw (owner) client
   * because public routes carry no tenant context and RLS would otherwise hide
   * every row / reject the insert. Never throws: a failed analytics write must
   * not break the tap render. Skips entirely when the company has explicitly
   * disabled analytics.
   */
  private async recordTap({ companyId, cardId, pageId, kind, req }: RecordTapArgs): Promise<void> {
    try {
      const settings = await this.prisma.$prisma.companySettings.findUnique({
        where: { companyId },
        select: { analyticsEnabled: true },
      });
      if (settings?.analyticsEnabled === false) return;

      const country = (req.headers['cf-ipcountry'] as string | undefined) ?? null;
      const ua = req.headers['user-agent'] as string | undefined;
      const referrer = (req.headers['referer'] as string | undefined) ?? null;

      await this.prisma.$prisma.tapEvent.create({
        data: {
          companyId,
          cardId: cardId ?? null,
          pageId: pageId ?? null,
          kind: kind ?? null,
          country,
          deviceType: this.deviceTypeFromUA(ua),
          referrer,
        },
      });

      log(LogKey.TAP_RECORDED, 'Public tap recorded', {
        companyId,
        cardId: cardId ?? null,
        pageId: pageId ?? null,
      });
    } catch {
      // Swallow: analytics is best-effort and must never fail a tap render.
    }
  }

  /**
   * Resolve a card link /c/<company slug>/<card slug>. The company may be
   * named by a slug it used before (printed cards keep working after a
   * rename). Raw client + explicit scoping (no tenant context here).
   */
  async resolveCard(companySlug: string, cardSlug: string, req: Request) {
    const company = await this.prisma.$prisma.company.findFirst({
      where: {
        OR: [{ slug: companySlug }, { previousSlugs: { has: companySlug } }],
      },
      select: { id: true },
    });
    const card = company
      ? await this.prisma.$prisma.card.findUnique({
          where: { companyId_slug: { companyId: company.id, slug: cardSlug } },
          include: CARD_TAP_INCLUDE,
        })
      : null;
    return this.answerTap(card, `${companySlug}/${cardSlug}`, req);
  }

  /**
   * The old /c/<slug> link. Only cards that existed before per-company links
   * answer it: their slugs were globally unique then.
   */
  async resolveLegacyCard(slug: string, req: Request) {
    const card = await this.prisma.$prisma.card.findFirst({
      where: { slug, legacyPath: true },
      include: CARD_TAP_INCLUDE,
    });
    return this.answerTap(card, slug, req);
  }

  /**
   * A missing card 404s; an inactive/unpublished card returns a lightweight
   * `inactive` payload (no tap recorded); a live card records a tap and returns
   * its active page, or its custom link.
   */
  private async answerTap(card: TapCard | null, path: string, req: Request) {
    // A deleted card answers exactly like one that never existed.
    if (!card || card.deletedAt) {
      log(LogKey.TAP_RESOLVE_MISS, 'Card slug not found', { slug: path });
      throw new NotFoundException('Card not found');
    }

    // A custom link: count the tap, then the app forwards the visitor.
    if (card.status === 'ACTIVE' && card.linkUrl) {
      await this.recordTap({ companyId: card.companyId, cardId: card.id, req });
      return {
        status: 'redirect' as const,
        card: { name: card.name, type: card.type },
        url: card.linkUrl,
      };
    }

    if (card.status !== 'ACTIVE' || !card.activePage || !card.activePage.published) {
      return {
        status: 'inactive' as const,
        card: { name: card.name, type: card.type },
      };
    }

    const page = card.activePage;

    await this.recordTap({
      companyId: card.companyId,
      cardId: card.id,
      pageId: page.id,
      kind: page.kind,
      req,
    });

    return {
      status: 'ok' as const,
      card: { id: card.id, name: card.name, type: card.type, design: card.design },
      page: publicPage(page, card.company.name),
    };
  }

  /**
   * Resolve a page slug directly (a shared page link, not via a card). Missing
   * or unpublished pages 404. Records a tap on success.
   */
  async resolvePage(slug: string, req: Request) {
    const page = await this.prisma.$prisma.page.findUnique({
      where: { slug },
      include: { company: { select: { name: true } } },
    });

    if (!page || page.deletedAt || !page.published) {
      throw new NotFoundException('Page not found');
    }

    await this.recordTap({
      companyId: page.companyId,
      pageId: page.id,
      kind: page.kind,
      req,
    });

    return {
      status: 'ok' as const,
      page: publicPage(page, page.company.name),
    };
  }
}
