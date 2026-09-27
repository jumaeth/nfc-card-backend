import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service.js';
import { UpdateMeDto } from './dto/update-me.dto.js';
import { BetterAuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { User } from '../../../generated/prisma/client.js';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(BetterAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @ApiOperation({ summary: 'Current user profile' })
  @Get('me')
  getMe(@CurrentUser() user: User) {
    return this.users.getMe(user.id);
  }

  @ApiOperation({ summary: 'Update the current user profile' })
  @Patch('me')
  updateMe(@CurrentUser() user: User, @Body() dto: UpdateMeDto) {
    return this.users.updateMe(user.id, dto);
  }
}
