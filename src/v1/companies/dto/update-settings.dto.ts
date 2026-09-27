import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateSettingsDto {
  @ApiPropertyOptional({
    example: true,
    description: 'Collect anonymised tap analytics.',
  })
  @IsOptional()
  @IsBoolean()
  analyticsEnabled?: boolean;

  @ApiPropertyOptional({
    example: 'de',
    description: 'Default display language for public pages.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  defaultLocale?: string;
}
