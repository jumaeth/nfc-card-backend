import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, ValidateIf } from 'class-validator';
import type { PlanTier, SubscriptionStatus } from '../../../../generated/prisma/client.js';

// Mirror the Prisma enums, declared inline for runtime validation.
const PLAN_TIERS = ['STARTER', 'PRO', 'MANAGED'] as const;
const SUBSCRIPTION_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'PAUSED'] as const;

export class SetSubscriptionDto {
  @ApiProperty({ enum: PLAN_TIERS })
  @IsIn(PLAN_TIERS)
  tier!: PlanTier;

  @ApiProperty({ enum: SUBSCRIPTION_STATUSES })
  @IsIn(SUBSCRIPTION_STATUSES)
  status!: SubscriptionStatus;

  @ApiPropertyOptional({ nullable: true, description: 'Period end (ISO date). null = open-ended' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString()
  currentPeriodEnd?: string | null;
}
