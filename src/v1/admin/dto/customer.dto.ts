import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

const SLUG = /^[a-z0-9-]+$/;
const SLUG_MESSAGE = 'slug must contain only lowercase letters, digits and hyphens';

export class ListCustomersQueryDto {
  @ApiPropertyOptional({ description: 'Search name, slug or billing email' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Filter by sales rep id, or "none" for unassigned' })
  @IsOptional()
  @IsString()
  salesRepId?: string;

  @ApiPropertyOptional({ enum: ['active', 'archived'], default: 'active' })
  @IsOptional()
  @IsIn(['active', 'archived'])
  status?: 'active' | 'archived';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class CreateCustomerDto {
  @ApiProperty({ example: 'Café Central' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'cafe-central' })
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  @Matches(SLUG, { message: SLUG_MESSAGE })
  slug!: string;

  @ApiPropertyOptional({ description: 'Invite this email as the company OWNER' })
  @IsOptional()
  @IsEmail()
  ownerEmail?: string;

  @ApiPropertyOptional({ description: 'Sales rep (ADMIN+ only; SALES always owns what it creates)' })
  @IsOptional()
  @IsString()
  salesRepId?: string;
}

export class UpdateCustomerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  @Matches(SLUG, { message: SLUG_MESSAGE })
  slug?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsEmail()
  billingEmail?: string | null;

  @ApiPropertyOptional({ example: '#2f6df0' })
  @IsOptional()
  @Matches(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
    message: 'brandColor must be a hex colour, e.g. #2f6df0',
  })
  brandColor?: string;

  @ApiPropertyOptional({
    description: 'Keep pages live and editable even when the plan does not include them',
  })
  @IsOptional()
  @IsBoolean()
  pagesOverride?: boolean;
}

export class AssignSalesRepDto {
  @ApiProperty({ nullable: true, description: 'Sales rep user id, or null to unassign' })
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  salesRepId!: string | null;
}

export class SetPublishedDto {
  @ApiProperty()
  @IsBoolean()
  published!: boolean;
}
