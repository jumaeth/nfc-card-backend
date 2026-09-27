import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  HttpCode,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
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
import { TranslateTextDto } from '../translate/dto/translate.dto.js';
import {
  CreateDesignTemplateDto,
  UpdateDesignTemplateDto,
} from '../design-templates/dto/design-template.dto.js';
import { CreateLocationDto } from '../locations/dto/create-location.dto.js';
import { UpdateLocationDto } from '../locations/dto/update-location.dto.js';
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
    return this.customers.setCardDestination(user, companyId, cardId, dto);
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

  @ApiOperation({ summary: 'Create a location for a customer (no plan limit)' })
  @Post(':companyId/locations')
  createLocation(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Body() dto: CreateLocationDto,
  ) {
    return this.customers.createLocation(user, companyId, dto);
  }

  @ApiOperation({ summary: 'Update a location, or make it the default' })
  @Patch(':companyId/locations/:locationId')
  updateLocation(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Param('locationId') locationId: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.customers.updateLocation(user, companyId, locationId, dto);
  }

  @ApiOperation({ summary: 'Delete a location (not the default)' })
  @Delete(':companyId/locations/:locationId')
  deleteLocation(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Param('locationId') locationId: string,
  ) {
    return this.customers.deleteLocation(user, companyId, locationId);
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

  @ApiOperation({ summary: 'Translate a field of a customer page (no monthly limit)' })
  // Each call costs money; same burst limit as the app's translate route.
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @HttpCode(200)
  @Post(':companyId/pages/:pageId/translate')
  translatePage(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Param('pageId') pageId: string,
    @Body() dto: TranslateTextDto,
  ) {
    return this.customers.translatePage(user, companyId, pageId, dto);
  }

  @ApiOperation({ summary: 'Upload a design image for a customer (raw bytes, max 5 MB)' })
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post(':companyId/uploads')
  uploadImage(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Req() req: Request,
  ) {
    return this.customers.uploadImage(user, companyId, req);
  }

  @ApiOperation({ summary: 'List a customer saved page designs' })
  @Get(':companyId/design-templates')
  listDesignTemplates(@CurrentUser() user: User, @Param('companyId') companyId: string) {
    return this.customers.listDesignTemplates(user, companyId);
  }

  @ApiOperation({ summary: 'Save a page design for a customer' })
  @Post(':companyId/design-templates')
  createDesignTemplate(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Body() dto: CreateDesignTemplateDto,
  ) {
    return this.customers.createDesignTemplate(user, companyId, dto);
  }

  @ApiOperation({ summary: 'Rename or overwrite a customer saved design' })
  @Patch(':companyId/design-templates/:id')
  updateDesignTemplate(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDesignTemplateDto,
  ) {
    return this.customers.updateDesignTemplate(user, companyId, id, dto);
  }

  @ApiOperation({ summary: 'Delete a customer saved design' })
  @HttpCode(204)
  @Delete(':companyId/design-templates/:id')
  deleteDesignTemplate(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.customers.deleteDesignTemplate(user, companyId, id);
  }

  @ApiOperation({ summary: 'Guests who asked for the Wi-Fi on a customer page' })
  @Get(':companyId/pages/:pageId/wifi-guests')
  listWifiGuests(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Param('pageId') pageId: string,
  ) {
    return this.customers.listWifiGuests(user, companyId, pageId);
  }

  @ApiOperation({ summary: 'Delete a Wi-Fi guest and their consent' })
  @Delete(':companyId/pages/:pageId/wifi-guests/:guestId')
  deleteWifiGuest(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Param('pageId') pageId: string,
    @Param('guestId') guestId: string,
  ) {
    return this.customers.deleteWifiGuest(user, companyId, pageId, guestId);
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
