import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { CardType } from '../../../../generated/prisma/client.js';

// Enum values mirror the Prisma `CardType`. Declared inline so class-validator
// has a runtime object to validate against (Prisma types are erased at build).
const CARD_TYPES = ['REVIEW', 'MENU', 'LINKHUB', 'VCARD', 'WIFI'] as const;

export class CreateCardDto {
  @ApiProperty({ example: 'Table 4 review card', minLength: 1, maxLength: 80 })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiProperty({ enum: CARD_TYPES, example: 'REVIEW' })
  @IsEnum(CARD_TYPES)
  type!: CardType;

  @ApiProperty({
    required: false,
    description:
      'Location this card belongs to. Must belong to the same company.',
  })
  @IsOptional()
  @IsString()
  locationId?: string;

  @ApiProperty({
    required: false,
    example: 'Terrasse',
    description: 'Zone inside the location, used to group cards (e.g. tables).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  area?: string;

  @ApiProperty({
    required: false,
    example: 'cafe-central',
    description:
      'Public tap slug (/c/[slug]). Lowercase letters, digits and hyphens, 3-40 chars. Auto-generated when omitted.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]{3,40}$/, {
    message: 'slug must be 3-40 chars of lowercase letters, digits or hyphens',
  })
  slug?: string;

  @ApiProperty({
    required: false,
    type: Object,
    description:
      'Physical/landing design JSON: { template, logoUrl, primaryColor, ... }.',
  })
  @IsOptional()
  @IsObject()
  design?: Record<string, unknown>;

  @ApiProperty({
    required: false,
    description:
      'Optional hardware UID of the NFC chip (for provisioning/verification).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  uid?: string;
}
