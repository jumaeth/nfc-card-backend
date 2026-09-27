import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminCustomersService } from './admin-customers.service.js';
import { AdminUsersService } from './admin-users.service.js';
import { BetterAuthGuard } from '../auth/auth.guard.js';
import { PlatformRoleGuard } from '../auth/platform-role.guard.js';
import { PlatformRoles } from '../auth/decorators/platform-roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ListUsersQueryDto, UpdatePlatformRoleDto } from './dto/users.dto.js';
import { UpdatePlanDto } from './dto/plans.dto.js';
import type { User } from '../../../generated/prisma/client.js';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(BetterAuthGuard, PlatformRoleGuard)
@PlatformRoles('SALES')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly customers: AdminCustomersService,
    private readonly users: AdminUsersService,
  ) {}

  @ApiOperation({ summary: 'Signed-in staff member and their console capabilities' })
  @Get('me')
  me(@CurrentUser() user: User) {
    return this.users.me(user);
  }

  @ApiOperation({ summary: 'Headline numbers for the caller scope' })
  @Get('overview')
  overview(@CurrentUser() user: User) {
    return this.customers.overview(user);
  }

  @ApiOperation({ summary: 'Plan catalogue' })
  @Get('plans')
  plans() {
    return this.users.listPlans();
  }

  @ApiOperation({ summary: 'Edit a plan (SUPER_ADMIN)' })
  @PlatformRoles('SUPER_ADMIN')
  @Patch('plans/:planId')
  updatePlan(@CurrentUser() user: User, @Param('planId') planId: string, @Body() dto: UpdatePlanDto) {
    return this.users.updatePlan(user, planId, dto);
  }

  @ApiOperation({ summary: 'Active sales reps (SUPPORT+)' })
  @PlatformRoles('SUPPORT')
  @Get('sales-reps')
  salesReps() {
    return this.users.salesReps();
  }

  @ApiOperation({ summary: 'All users (SUPPORT+)' })
  @PlatformRoles('SUPPORT')
  @Get('users')
  listUsers(@Query() query: ListUsersQueryDto) {
    return this.users.list(query);
  }

  @ApiOperation({ summary: 'User detail (SUPPORT+)' })
  @PlatformRoles('SUPPORT')
  @Get('users/:userId')
  userDetail(@Param('userId') userId: string) {
    return this.users.detail(userId);
  }

  @ApiOperation({ summary: 'Change a user platform role (ADMIN+)' })
  @PlatformRoles('ADMIN')
  @Patch('users/:userId/role')
  setRole(
    @CurrentUser() user: User,
    @Param('userId') userId: string,
    @Body() dto: UpdatePlatformRoleDto,
  ) {
    return this.users.setRole(user, userId, dto.platformRole);
  }
}
