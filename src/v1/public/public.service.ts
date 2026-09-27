import { Injectable, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { PageKind } from '../../../generated/prisma/client.js';
import { log, LogKey } from '../../logger/index.js';

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
   * Resolve a card slug to its live tap destination. Raw client + explicit
   * slug scoping (no tenant context on public routes). A missing card 404s; an
   * inactive/unpublished card returns a lightweight `inactive` payload (no tap
   * recorded); a live card records a tap and returns its active page.
   */
  async resolveCard(slug: string, req: Request) {
    const card = await this.prisma.$prisma.card.findUnique({
      where: { slug },
      include: { activePage: true },
    });

    if (!card) {
      log(LogKey.TAP_RESOLVE_MISS, 'Card slug not found', { slug });
      throw new NotFoundException('Card not found');
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
      page: {
        id: page.id,
        kind: page.kind,
        name: page.name,
        theme: page.theme,
        content: page.content,
        slug: page.slug,
      },
    };
  }

  /**
   * Resolve a page slug directly (a shared page link, not via a card). Missing
   * or unpublished pages 404. Records a tap on success.
   */
  async resolvePage(slug: string, req: Request) {
    const page = await this.prisma.$prisma.page.findUnique({ where: { slug } });

    if (!page || !page.published) {
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
      page: {
        id: page.id,
        kind: page.kind,
        name: page.name,
        theme: page.theme,
        content: page.content,
        slug: page.slug,
      },
    };
  }
}
