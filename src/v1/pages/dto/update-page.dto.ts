import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdatePageDto {
  @ApiPropertyOptional({ example: 'Front desk review card', minLength: 1, maxLength: 80 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Reassign the page to another location, or null to detach it.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  locationId?: string | null;

  @ApiPropertyOptional({ description: 'Kind-specific builder content (see create DTO header).', type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  content?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Visual theme.', type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  theme?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Publish or unpublish the page.' })
  @IsOptional()
  @IsBoolean()
  published?: boolean;
}
