import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BetterAuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { User } from '../../../generated/prisma/client.js';
import { WifiAccessService } from './wifi-access.service.js';
import { WifiGuestsService } from './wifi-guests.service.js';
import {
  RequestWifiAccessDto,
  VerifyWifiAccessDto,
} from './dto/wifi-access.dto.js';

// Unauthenticated: guests on a WIFI page. Tight per-IP limits because these
// endpoints send email and check codes.
@ApiTags('public')
@Controller('public/pages/:slug/wifi')
export class PublicWifiController {
  constructor(private readonly wifi: WifiAccessService) {}

  @ApiOperation({
    summary: 'Guest leaves their email (grants access or emails a code)',
  })
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  @Post('access')
  requestAccess(
    @Param('slug') slug: string,
    @Body() dto: RequestWifiAccessDto,
  ) {
    return this.wifi.requestAccess(slug, dto);
  }

  @ApiOperation({ summary: 'Guest confirms the emailed code' })
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('verify')
  verify(@Param('slug') slug: string, @Body() dto: VerifyWifiAccessDto) {
    return this.wifi.verify(slug, dto);
  }

  @ApiOperation({ summary: 'Password for a returning guest (access token)' })
  @Get('credentials')
  credentials(@Param('slug') slug: string, @Query('token') token?: string) {
    return this.wifi.credentials(slug, token);
  }

  @ApiOperation({ summary: 'iOS Wi-Fi profile (.mobileconfig)' })
  @Get('profile.mobileconfig')
  @Header('Content-Type', 'application/x-apple-aspen-config')
  @Header('Content-Disposition', 'attachment; filename="wifi.mobileconfig"')
  @Header('Cache-Control', 'no-store')
  profile(@Param('slug') slug: string, @Query('token') token?: string) {
    return this.wifi.profile(slug, token);
  }
}

@ApiTags('pages')
@ApiBearerAuth()
@UseGuards(BetterAuthGuard)
@Controller('companies/:companyId/pages/:pageId/wifi-guests')
export class WifiGuestsController {
  constructor(private readonly guests: WifiGuestsService) {}

  @ApiOperation({ summary: 'Guests who asked for the Wi-Fi on this page' })
  @Get()
  list(
    @Param('companyId') companyId: string,
    @Param('pageId') pageId: string,
    @CurrentUser() user: User,
  ) {
    return this.guests.list(companyId, pageId, user.id);
  }

  @ApiOperation({ summary: 'Delete a guest and their consent (ADMIN+)' })
  @Delete(':guestId')
  remove(
    @Param('companyId') companyId: string,
    @Param('pageId') pageId: string,
    @Param('guestId') guestId: string,
    @CurrentUser() user: User,
  ) {
    return this.guests.remove(companyId, pageId, guestId, user.id);
  }
}
