import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateCompanyDto {
  @ApiPropertyOptional({ example: 'Café Central', minLength: 1, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    example: 'cafe-central',
    description: 'URL identifier: lowercase letters, digits and hyphens.',
    minLength: 2,
    maxLength: 40,
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'slug must contain only lowercase letters, digits and hyphens',
  })
  slug?: string;

  @ApiPropertyOptional({ example: 'https://cdn.taplino.ch/logo/abc.png' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  logo?: string;

  @ApiPropertyOptional({ example: '#f0431f' })
  @IsOptional()
  @IsString()
  @Matches(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
    message: 'brandColor must be a hex colour, e.g. #f0431f',
  })
  brandColor?: string;
}
