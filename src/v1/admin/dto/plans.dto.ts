import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdatePlanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ description: 'Price in Rappen (CHF cents)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(255)
  stripePriceId?: string | null;

  @ApiPropertyOptional({
    type: Object,
    description: '{ analytics, multiLocation, maxLocations, unlimitedDestinationChanges, managed, createPages }',
  })
  @IsOptional()
  @IsObject()
  features?: Record<string, unknown>;
}
