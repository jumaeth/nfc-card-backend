import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { MaxJsonSize, MAX_THEME_BYTES } from '../../../common/max-json-size.js';

export class CreateDesignTemplateDto {
  @ApiProperty({ example: 'Trattoria', minLength: 1, maxLength: 60 })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @ApiProperty({
    description: 'Same shape as Page.theme.',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  @MaxJsonSize(MAX_THEME_BYTES)
  theme!: Record<string, unknown>;
}

export class UpdateDesignTemplateDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 60 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  @MaxJsonSize(MAX_THEME_BYTES)
  theme?: Record<string, unknown>;
}
