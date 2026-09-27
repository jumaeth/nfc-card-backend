import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { PlatformRole } from '../../../../generated/prisma/client.js';

// Mirrors the Prisma `PlatformRole`, declared inline for runtime validation.
export const PLATFORM_ROLES_LIST = ['USER', 'SALES', 'SUPPORT', 'ADMIN', 'SUPER_ADMIN'] as const;

export class ListUsersQueryDto {
  @ApiPropertyOptional({ description: 'Search name or email' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: [...PLATFORM_ROLES_LIST, 'STAFF'] })
  @IsOptional()
  @IsIn([...PLATFORM_ROLES_LIST, 'STAFF'])
  role?: PlatformRole | 'STAFF';

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

export class UpdatePlatformRoleDto {
  @ApiProperty({ enum: PLATFORM_ROLES_LIST })
  @IsIn(PLATFORM_ROLES_LIST)
  platformRole!: PlatformRole;
}
