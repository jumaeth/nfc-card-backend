import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CompaniesService } from './companies.service.js';
import { CreateCompanyDto } from './dto/create-company.dto.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';
import { UpdateMemberDto } from './dto/update-member.dto.js';
import { UpdateSettingsDto } from './dto/update-settings.dto.js';
import { BetterAuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { User } from '../../../generated/prisma/client.js';

@ApiTags('companies')
@ApiBearerAuth()
@UseGuards(BetterAuthGuard)
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @ApiOperation({ summary: 'List the companies the current user belongs to' })
  @Get()
  listMine(@CurrentUser() user: User) {
    return this.companies.listMine(user.id);
  }

  @ApiOperation({ summary: 'Create a company (the creator becomes its owner)' })
  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateCompanyDto) {
    return this.companies.create(user.id, dto);
  }

  @ApiOperation({ summary: 'Get a single company' })
  @Get(':companyId')
  findOne(@CurrentUser() user: User, @Param('companyId') companyId: string) {
    return this.companies.findOne(companyId, user.id);
  }

  @ApiOperation({ summary: 'Update a company (ADMIN+)' })
  @Patch(':companyId')
  update(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companies.update(companyId, user.id, dto);
  }

  @ApiOperation({ summary: 'List company members' })
  @Get(':companyId/members')
  listMembers(@CurrentUser() user: User, @Param('companyId') companyId: string) {
    return this.companies.listMembers(companyId, user.id);
  }

  @ApiOperation({ summary: 'Update a member role or permissions (ADMIN+)' })
  @Patch(':companyId/members/:userId')
  updateMember(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Param('userId') targetUserId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.companies.updateMember(companyId, user.id, targetUserId, dto);
  }

  @ApiOperation({ summary: 'Remove a member (ADMIN+)' })
  @Delete(':companyId/members/:userId')
  removeMember(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Param('userId') targetUserId: string,
  ) {
    return this.companies.removeMember(companyId, user.id, targetUserId);
  }

  @ApiOperation({ summary: 'Read company settings' })
  @Get(':companyId/settings')
  getSettings(@CurrentUser() user: User, @Param('companyId') companyId: string) {
    return this.companies.getSettings(companyId, user.id);
  }

  @ApiOperation({ summary: 'Update company settings (ADMIN+)' })
  @Patch(':companyId/settings')
  updateSettings(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.companies.updateSettings(companyId, user.id, dto);
  }
}
