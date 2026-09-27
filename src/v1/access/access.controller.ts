import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessService } from './access.service.js';
import { BetterAuthGuard } from '../auth/auth.guard.js';
import { SkipPasskeyGate } from '../auth/decorators/skip-passkey-gate.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { User } from '../../../generated/prisma/client.js';

@ApiTags('access')
@ApiBearerAuth()
@UseGuards(BetterAuthGuard)
@SkipPasskeyGate()
@Controller('access')
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @ApiOperation({ summary: 'Bootstrap context: user, companies, passkey posture' })
  @Get()
  getAccess(@CurrentUser() user: User) {
    return this.access.getAccess(user.id);
  }
}
