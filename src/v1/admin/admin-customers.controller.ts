import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminCustomersService } from './admin-customers.service.js';
import { BetterAuthGuard } from '../auth/auth.guard.js';
import { PlatformRoleGuard } from '../auth/platform-role.guard.js';
import { PlatformRoles } from '../auth/decorators/platform-roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import {
  AssignSalesRepDto,
  CreateCustomerDto,
  ListCustomersQueryDto,
  UpdateCustomerDto,
} from './dto/customer.dto.js';
import { SetSubscriptionDto } from './dto/subscription.dto.js';
import { AdminInviteDto, AdminUpdateMemberDto } from './dto/members.dto.js';
import { CreateCardDto } from '../cards/dto/create-card.dto.js';
import { UpdateCardDto } from '../cards/dto/update-card.dto.js';
import { SetDestinationDto } from '../cards/dto/set-destination.dto.js';
import { CreatePageDto } from '../pages/dto/create-page.dto.js';
import { UpdatePageDto } from '../pages/dto/update-page.dto.js';
import type { User } from '../../../generated/prisma/client.js';

// All staff reach these routes; the service narrows SALES to its own customers
// and makes SUPPORT read-only.
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(BetterAuthGuard, PlatformRoleGuard)
@PlatformRoles('SALES')
@Controller('admin/companies')
export class AdminCustomersController {
  constructor(private readonly customers: AdminCustomersService) {}

  @ApiOperation({ summary: 'List customers in the caller scope' })
  @Get()
  list(@CurrentUser() user: User, @Query() query: ListCustomersQueryDto) {
    return this.customers.list(user, query);
  }

  @ApiOperation({ summary: 'Create a customer, optionally inviting its owner' })
  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateCustomerDto) {
    return this.customers.create(user, dto);
  }

  @ApiOperation({ summary: 'Customer detail' })
  @Get(':companyId')
  detail(@CurrentUser() user: User, @Param('companyId') companyId: string) {
    return this.customers.detail(user, companyId);
  }

  @ApiOperation({ summary: 'Update customer details' })
  @Patch(':companyId')
  update(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customers.update(user, companyId, dto);
  }

  @ApiOperation({ summary: 'Assign or clear the sales rep (ADMIN+)' })
  @PlatformRoles('ADMIN')
  @Put(':companyId/sales-rep')
  assignSalesRep(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Body() dto: AssignSalesRepDto,
  ) {
    return this.customers.assignSalesRep(user, companyId, dto.salesRepId);
  }

  @ApiOperation({ summary: 'Archive a customer (ADMIN+)' })
  @PlatformRoles('ADMIN')
  @Post(':companyId/archive')
  archive(@CurrentUser() user: User, @Param('companyId') companyId: string) {
    return this.customers.setArchived(user, companyId, true);
  }

  @ApiOperation({ summary: 'Restore an archived customer (ADMIN+)' })
  @PlatformRoles('ADMIN')
  @Post(':companyId/restore')
  restore(@CurrentUser() user: User, @Param('companyId') companyId: string) {
    return this.customers.setArchived(user, companyId, false);
  }

  @ApiOperation({ summary: 'Set the plan and status (manual subscription)' })
  @Put(':companyId/subscription')
  setSubscription(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Body() dto: SetSubscriptionDto,
  ) {
    return this.customers.setSubscription(user, companyId, dto);
  }

  @ApiOperation({ summary: 'Invite a member (any role, incl. OWNER)' })
  @Post(':companyId/invitations')
  invite(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Body() dto: AdminInviteDto,
  ) {
    return this.customers.invite(user, companyId, dto);
  }

  @ApiOperation({ summary: 'Cancel a pending invitation' })
  @Delete(':companyId/invitations/:invitationId')
  cancelInvitation(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.customers.cancelInvitation(user, companyId, invitationId);
  }

  @ApiOperation({ summary: 'Change a member role' })
  @Patch(':companyId/members/:userId')
  updateMember(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Param('userId') userId: string,
    @Body() dto: AdminUpdateMemberDto,
  ) {
    return this.customers.updateMember(user, companyId, userId, dto);
  }

  @ApiOperation({ summary: 'Remove a member' })
  @Delete(':companyId/members/:userId')
  removeMember(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Param('userId') userId: string,
  ) {
    return this.customers.removeMember(user, companyId, userId);
  }

  @ApiOperation({ summary: 'List a customer cards' })
  @Get(':companyId/cards')
  listCards(@CurrentUser() user: User, @Param('companyId') companyId: string) {
    return this.customers.listCards(user, companyId);
  }

  @ApiOperation({ summary: 'Provision a card for a customer' })
  @Post(':companyId/cards')
  createCard(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Body() dto: CreateCardDto,
  ) {
    return this.customers.createCard(user, companyId, dto);
  }

  @ApiOperation({ summary: 'Update a card' })
  @Patch(':companyId/cards/:cardId')
  updateCard(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Param('cardId') cardId: string,
    @Body() dto: UpdateCardDto,
  ) {
    return this.customers.updateCard(user, companyId, cardId, dto);
  }

  @ApiOperation({ summary: 'Point a card at a page, or clear it' })
  @Put(':companyId/cards/:cardId/destination')
  setCardDestination(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Param('cardId') cardId: string,
    @Body() dto: SetDestinationDto,
  ) {
    return this.customers.setCardDestination(user, companyId, cardId, dto.pageId);
  }

  @ApiOperation({ summary: 'Delete a card' })
  @Delete(':companyId/cards/:cardId')
  deleteCard(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Param('cardId') cardId: string,
  ) {
    return this.customers.deleteCard(user, companyId, cardId);
  }

  @ApiOperation({ summary: 'List a customer pages' })
  @Get(':companyId/pages')
  listPages(@CurrentUser() user: User, @Param('companyId') companyId: string) {
    return this.customers.listPages(user, companyId);
  }

  @ApiOperation({ summary: 'Create a page for a customer' })
  @Post(':companyId/pages')
  createPage(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Body() dto: CreatePageDto,
  ) {
    return this.customers.createPage(user, companyId, dto);
  }

  @ApiOperation({ summary: 'List a customer deleted pages (SUPER_ADMIN)' })
  @PlatformRoles('SUPER_ADMIN')
  @Get(':companyId/deleted-pages')
  listDeletedPages(@CurrentUser() user: User, @Param('companyId') companyId: string) {
    return this.customers.listDeletedPages(user, companyId);
  }

  @ApiOperation({ summary: 'Restore a deleted page as a draft (SUPER_ADMIN)' })
  @PlatformRoles('SUPER_ADMIN')
  @Post(':companyId/pages/:pageId/restore')
  restorePage(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Param('pageId') pageId: string,
  ) {
    return this.customers.restorePage(user, companyId, pageId);
  }

  @ApiOperation({ summary: 'Get a customer page with its content' })
  @Get(':companyId/pages/:pageId')
  getPage(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Param('pageId') pageId: string,
  ) {
    return this.customers.getPage(user, companyId, pageId);
  }

  @ApiOperation({ summary: 'Update a customer page' })
  @Patch(':companyId/pages/:pageId')
  updatePage(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Param('pageId') pageId: string,
    @Body() dto: UpdatePageDto,
  ) {
    return this.customers.updatePage(user, companyId, pageId, dto);
  }

  @ApiOperation({ summary: 'Delete a customer page (soft delete)' })
  @Delete(':companyId/pages/:pageId')
  deletePage(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Param('pageId') pageId: string,
  ) {
    return this.customers.deletePage(user, companyId, pageId);
  }
}
