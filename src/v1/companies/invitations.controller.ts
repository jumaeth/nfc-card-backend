import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CompaniesService } from './companies.service.js';
import { InviteMemberDto } from './dto/invite-member.dto.js';
import { AcceptInvitationDto } from './dto/accept-invitation.dto.js';
import { BetterAuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { User } from '../../../generated/prisma/client.js';

// Guards are applied per-method: every route here needs auth EXCEPT the public
// invitation lookup, which the front-end calls before the recipient signs in.
@ApiTags('invitations')
@Controller()
export class InvitationsController {
  constructor(private readonly companies: CompaniesService) {}

  @ApiBearerAuth()
  @UseGuards(BetterAuthGuard)
  @ApiOperation({ summary: 'Invite a member to a company (ADMIN+)' })
  @Post('companies/:companyId/invitations')
  create(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Body() dto: InviteMemberDto,
  ) {
    return this.companies.createInvitation(companyId, user.id, dto);
  }

  @ApiBearerAuth()
  @UseGuards(BetterAuthGuard)
  @ApiOperation({ summary: 'List a company invitations (ADMIN+)' })
  @Get('companies/:companyId/invitations')
  list(@CurrentUser() user: User, @Param('companyId') companyId: string) {
    return this.companies.listInvitations(companyId, user.id);
  }

  @ApiBearerAuth()
  @UseGuards(BetterAuthGuard)
  @ApiOperation({ summary: 'Cancel a pending invitation (ADMIN+)' })
  @Delete('companies/:companyId/invitations/:id')
  cancel(
    @CurrentUser() user: User,
    @Param('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.companies.cancelInvitation(companyId, user.id, id);
  }

  @ApiBearerAuth()
  @UseGuards(BetterAuthGuard)
  @ApiOperation({ summary: 'Accept an invitation with a code or token' })
  @Post('invitations/accept')
  accept(@CurrentUser() user: User, @Body() dto: AcceptInvitationDto) {
    return this.companies.acceptInvitation(user.id, dto.code);
  }

  @ApiOperation({ summary: 'Public: look up an invitation by code or token' })
  @Get('invitations/:token')
  getInfo(@Param('token') token: string) {
    return this.companies.getInvitationInfo(token);
  }
}
