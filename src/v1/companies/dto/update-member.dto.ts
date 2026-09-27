import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional } from 'class-validator';
import type { Permission } from '../../../../generated/prisma/client.js';

const PERMISSIONS = ['MANAGE_CARDS', 'MANAGE_BILLING'] as const;

export class UpdateMemberDto {
  @ApiPropertyOptional({ enum: ['ADMIN', 'MEMBER'] })
  @IsOptional()
  @IsIn(['ADMIN', 'MEMBER'])
  role?: 'ADMIN' | 'MEMBER';

  @ApiPropertyOptional({ enum: PERMISSIONS, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(PERMISSIONS, { each: true })
  permissions?: Permission[];
}
