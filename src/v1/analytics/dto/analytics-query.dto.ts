import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString } from 'class-validator';

/**
 * Query filters for the analytics endpoints. Both `from` and `to` are ISO date
 * strings; when omitted the service defaults to the last 30 days. `locationId`
 * narrows the results to a single site.
 */
export class AnalyticsQueryDto {
  @ApiPropertyOptional({
    example: '2026-08-01',
    description: 'Start of the range (inclusive), ISO date. Defaults to 30 days ago.',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-09-01',
    description: 'End of the range (inclusive), ISO date. Defaults to now.',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    description: 'Restrict results to a single location.',
  })
  @IsOptional()
  @IsString()
  locationId?: string;
}
