import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

export class CreateLocationDto {
  @ApiProperty({ example: 'Café Central Zürich', minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ required: false, example: 'Bahnhofstrasse 1' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @ApiProperty({ required: false, example: 'Zürich' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiProperty({ required: false, example: '8001' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @ApiProperty({ required: false, example: 'CH', description: 'ISO country code. Defaults to CH.' })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string;

  @ApiProperty({ required: false, example: 'Europe/Zurich', description: 'IANA timezone. Defaults to Europe/Zurich.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiProperty({ required: false, description: 'Google Place ID for the review integration.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  googlePlaceId?: string;

  @ApiProperty({ required: false, example: 'https://g.page/r/...', description: 'Direct Google review URL.' })
  @IsOptional()
  @IsUrl()
  @MaxLength(2048)
  googleReviewUrl?: string;

  @ApiProperty({ required: false, description: 'Make this the company default location.' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
