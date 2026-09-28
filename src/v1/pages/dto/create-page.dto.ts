/**
 * Page.content JSON shape by `kind` (deep shape validated client-side; the
 * backend validates only that `content`/`theme` are objects). Front-end and
 * back-end must agree on these contracts:
 *
 * Localised strings are `{ de?, en?, fr?, it? }` (`I18n` below).
 *
 * REVIEW:
 *   {
 *     provider: 'google',
 *     placeId?: string,
 *     reviewUrl: string,
 *     threshold?: number,               // 1..5; ratings at/above go straight to the provider
 *     collectNegativeInternally?: boolean,
 *     feedbackEmail?: string,
 *   }
 *
 * MENU:
 *   {
 *     currency: string,                 // e.g. 'CHF'
 *     sections: [{
 *       id: string,
 *       name: I18n,
 *       items: [{
 *         id: string,
 *         name: I18n,
 *         description?: I18n,
 *         priceCents: number,
 *         allergens?: string[],
 *         tags?: string[],
 *         imageUrl?: string,
 *         available?: boolean,
 *       }],
 *     }],
 *   }
 *
 * LINKHUB:
 *   {
 *     headline?: I18n,
 *     avatarUrl?: string,
 *     links: [{ id: string, label: I18n, url: string, icon?: string }],
 *     socials: [{ platform: string, url: string }],
 *   }
 *
 * VCARD:
 *   {
 *     firstName: string,
 *     lastName: string,
 *     org?: string,
 *     title?: string,
 *     phones?: [{ label: string, number: string }],
 *     emails?: [{ label: string, address: string }],
 *     website?: string,
 *     address?: string,
 *     socials?: [{ platform: string, url: string }],
 *   }
 *
 * WIFI:
 *   {
 *     ssid: string,
 *     password?: string,
 *     encryption: 'WPA' | 'WEP' | 'nopass',
 *     hidden?: boolean,
 *   }
 *
 * Page.theme (all kinds):
 *   { brandColor?, background?, textColor?, logoUrl?, cardStyle? }  // all optional strings
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { PageKind } from '../../../../generated/prisma/client.js';
import { MaxJsonSize, MAX_THEME_BYTES } from '../../../common/max-json-size.js';

// Enum values mirror the Prisma `PageKind`. Declared inline so class-validator
// has a runtime object to validate against (Prisma types are erased at build).
const PAGE_KINDS = ['REVIEW', 'MENU', 'LINKHUB', 'VCARD', 'WIFI'] as const;

export class CreatePageDto {
  @ApiProperty({ enum: PAGE_KINDS, example: 'REVIEW' })
  @IsEnum(PAGE_KINDS)
  kind!: PageKind;

  @ApiProperty({ example: 'Front desk review card', minLength: 1, maxLength: 80 })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ description: 'Location this page belongs to (must be in the company).' })
  @IsOptional()
  @IsString()
  locationId?: string;

  @ApiPropertyOptional({
    description: 'Public slug. Lowercase letters, digits and hyphens, 3..40 chars. Auto-generated if omitted.',
    example: 'central-menu',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]{3,40}$/, {
    message: 'slug must be 3..40 lowercase letters, digits or hyphens',
  })
  slug?: string;

  @ApiPropertyOptional({ description: 'Kind-specific builder content (see file header).', type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  content?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Visual theme.', type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  @MaxJsonSize(MAX_THEME_BYTES)
  theme?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Whether the page is published. Defaults to false.' })
  @IsOptional()
  @IsBoolean()
  published?: boolean;
}
