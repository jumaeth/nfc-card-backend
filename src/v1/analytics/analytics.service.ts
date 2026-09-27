import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CompanyAccessService } from '../companies/company-access.service.js';
import { BillingService } from '../billing/billing.service.js';
import type { AnalyticsQueryDto } from './dto/analytics-query.dto.js';
import type { Prisma } from '../../../generated/prisma/client.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RANGE_DAYS = 30;

/** A single day's tap count in the time series. */
export interface SeriesPoint {
  /** UTC calendar day, `YYYY-MM-DD`. */
  date: string;
  taps: number;
}

export interface AnalyticsSummary {
  totals: {
    taps: number;
    byKind: Record<string, number>;
  };
  series: SeriesPoint[];
  topCards: { cardId: string; name: string; taps: number }[];
  /** Whether the company's plan includes analytics. Frontend upsell hint. */
  analyticsEnabled: boolean;
}

export interface CardBreakdownRow {
  cardId: string;
  name: string;
  type: string;
  taps: number;
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CompanyAccessService,
    private readonly billing: BillingService,
  ) {}

  /**
   * Resolve the [from, to] range for a query, defaulting to the last 30 days.
   * `to` is clamped so it is never before `from`.
   */
  private resolveRange(query: AnalyticsQueryDto): { from: Date; to: Date } {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
    if (from.getTime() > to.getTime()) {
      return { from: to, to: from };
    }
    return { from, to };
  }

  /**
   * Base `where` for tap events in range. When `locationId` is set we scope via
   * the card relation, since TapEvent has no direct location column.
   */
  private buildWhere(
    companyId: string,
    from: Date,
    to: Date,
    locationId?: string,
  ): Prisma.TapEventWhereInput {
    const where: Prisma.TapEventWhereInput = {
      companyId,
      createdAt: { gte: from, lte: to },
    };
    if (locationId) {
      where.card = { locationId };
    }
    return where;
  }

  /** Bucket day-resolution timestamps into a zero-filled UTC series. */
  private buildSeries(createdAts: Date[], from: Date, to: Date): SeriesPoint[] {
    const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

    const buckets = new Map<string, number>();
    for (const ts of createdAts) {
      const key = dayKey(ts);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }

    // Zero-fill each UTC day from `from` to `to` inclusive.
    const series: SeriesPoint[] = [];
    const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
    const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
    for (let t = start; t <= end; t += DAY_MS) {
      const key = new Date(t).toISOString().slice(0, 10);
      series.push({ date: key, taps: buckets.get(key) ?? 0 });
    }
    return series;
  }

  async getSummary(
    companyId: string,
    userId: string,
    query: AnalyticsQueryDto,
  ): Promise<AnalyticsSummary> {
    await this.access.requireMember(userId, companyId);
    const { from, to } = this.resolveRange(query);
    const where = this.buildWhere(companyId, from, to, query.locationId);

    const [taps, byKindGroups, seriesRows, topCardGroups, features] = await Promise.all([
      this.prisma.tapEvent.count({ where }),
      this.prisma.tapEvent.groupBy({
        by: ['kind'],
        where,
        _count: { _all: true },
      }),
      this.prisma.tapEvent.findMany({
        where,
        select: { createdAt: true },
      }),
      this.prisma.tapEvent.groupBy({
        by: ['cardId'],
        where: { ...where, cardId: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { cardId: 'desc' } },
        take: 5,
      }),
      this.billing.getCompanyFeatures(companyId),
    ]);

    const byKind: Record<string, number> = {};
    for (const g of byKindGroups) {
      byKind[g.kind ?? 'unknown'] = g._count._all;
    }

    const series = this.buildSeries(
      seriesRows.map((r) => r.createdAt),
      from,
      to,
    );

    const cardIds = topCardGroups
      .map((g) => g.cardId)
      .filter((id): id is string => id !== null);
    const cards = cardIds.length
      ? await this.prisma.card.findMany({
          where: { id: { in: cardIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(cards.map((c) => [c.id, c.name]));

    const topCards = topCardGroups
      .filter((g): g is typeof g & { cardId: string } => g.cardId !== null)
      .map((g) => ({
        cardId: g.cardId,
        name: nameById.get(g.cardId) ?? 'Unknown card',
        taps: g._count._all,
      }));

    return {
      totals: { taps, byKind },
      series,
      topCards,
      analyticsEnabled: features.analytics,
    };
  }

  async getCardBreakdown(
    companyId: string,
    userId: string,
    query: AnalyticsQueryDto,
  ): Promise<CardBreakdownRow[]> {
    await this.access.requireMember(userId, companyId);
    const { from, to } = this.resolveRange(query);
    const where = this.buildWhere(companyId, from, to, query.locationId);

    const groups = await this.prisma.tapEvent.groupBy({
      by: ['cardId'],
      where: { ...where, cardId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { cardId: 'desc' } },
    });

    const cardIds = groups
      .map((g) => g.cardId)
      .filter((id): id is string => id !== null);
    const cards = cardIds.length
      ? await this.prisma.card.findMany({
          where: { id: { in: cardIds } },
          select: { id: true, name: true, type: true },
        })
      : [];
    const cardById = new Map(cards.map((c) => [c.id, c]));

    return groups
      .filter((g): g is typeof g & { cardId: string } => g.cardId !== null)
      .map((g) => {
        const card = cardById.get(g.cardId);
        return {
          cardId: g.cardId,
          name: card?.name ?? 'Unknown card',
          type: card?.type ?? 'UNKNOWN',
          taps: g._count._all,
        };
      });
  }
}
