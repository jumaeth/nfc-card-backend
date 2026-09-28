import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, MaxLength } from 'class-validator';
import type { PlanTier } from '../../../../generated/prisma/client.js';

const PLAN_TIERS = ['STARTER', 'PRO', 'MANAGED'] as const;

export class ChangePlanDto {
  @ApiProperty({ enum: PLAN_TIERS, example: 'PRO' })
  @IsEnum(PLAN_TIERS)
  tier!: PlanTier;
}

export class ConfirmCheckoutDto {
  @ApiProperty()
  @IsString()
  @MaxLength(255)
  sessionId!: string;
}
