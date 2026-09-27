import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service.js';
import { AnalyticsQueryDto } from './dto/analytics-query.dto.js';
import { BetterAuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { User } from '../../../generated/prisma/client.js';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(BetterAuthGuard)
@Controller('companies/:companyId')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @ApiOperation({ summary: 'Tap analytics summary: totals, daily series and top cards' })
  @Get('analytics/summary')
  getSummary(
    @Param('companyId') companyId: string,
    @CurrentUser() user: User,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analytics.getSummary(companyId, user.id, query);
  }

  @ApiOperation({ summary: 'Per-card tap breakdown for the range' })
  @Get('analytics/cards')
  getCards(
    @Param('companyId') companyId: string,
    @CurrentUser() user: User,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analytics.getCardBreakdown(companyId, user.id, query);
  }
}
