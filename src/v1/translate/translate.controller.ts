import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BetterAuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { User } from '../../../generated/prisma/client.js';
import { TranslateService } from './translate.service.js';
import { TranslateDto } from './dto/translate.dto.js';

@ApiTags('translate')
@ApiBearerAuth()
@UseGuards(BetterAuthGuard)
@Controller('companies/:companyId')
export class TranslateController {
  constructor(private readonly translate: TranslateService) {}

  @ApiOperation({
    summary:
      'Translate page text into other page languages (ADMIN+). Limited to 5 pages per company per month, staff exempt.',
  })
  // Each call costs money, so keep it well below the global limit.
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @HttpCode(200)
  @Post('translate')
  create(
    @Param('companyId') companyId: string,
    @CurrentUser() user: User,
    @Body() dto: TranslateDto,
  ) {
    return this.translate.translate(companyId, user, dto);
  }
}
