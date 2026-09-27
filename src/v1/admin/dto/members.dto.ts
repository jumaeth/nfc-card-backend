import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn } from 'class-validator';
import type { CompanyRole } from '../../../../generated/prisma/client.js';

// Staff may hand out OWNER too (e.g. the first owner of a new customer).
const COMPANY_ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const;

export class AdminInviteDto {
  @ApiProperty({ example: 'owner@cafe-central.ch' })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: COMPANY_ROLES })
  @IsIn(COMPANY_ROLES)
  role!: CompanyRole;
}

export class AdminUpdateMemberDto {
  @ApiProperty({ enum: COMPANY_ROLES })
  @IsIn(COMPANY_ROLES)
  role!: CompanyRole;
}
