import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import type { CardStatus } from '../../../../generated/prisma/client.js';

// Mirrors the Prisma `CardStatus`, declared inline for runtime validation.
const CARD_STATUSES = ['UNASSIGNED', 'ACTIVE', 'DISABLED'] as const;

export class UpdateCardDto {
  @ApiProperty({
    required: false,
    example: 'Table 4 review card',
    minLength: 1,
    maxLength: 80,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Reassign to another company location, or null to detach.',
  })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  locationId?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    example: 'Terrasse',
    description: 'Zone inside the location, or null to clear it.',
  })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(40)
  area?: string | null;

  @ApiProperty({ required: false, enum: CARD_STATUSES, example: 'ACTIVE' })
  @IsOptional()
  @IsEnum(CARD_STATUSES)
  status?: CardStatus;

  @ApiProperty({
    required: false,
    type: Object,
    description: 'Physical/landing design JSON.',
  })
  @IsOptional()
  @IsObject()
  design?: Record<string, unknown>;
}
