import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { PagesService } from './pages.service.js';
import { CreatePageDto } from './dto/create-page.dto.js';
import { UpdatePageDto } from './dto/update-page.dto.js';
import { BetterAuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { PageKind } from '../../../generated/prisma/client.js';
import type { User } from '../../../generated/prisma/client.js';

@ApiTags('pages')
@ApiBearerAuth()
@UseGuards(BetterAuthGuard)
@Controller('companies/:companyId')
export class PagesController {
  constructor(private readonly pages: PagesService) {}

  @ApiOperation({ summary: "List the company's pages" })
  @ApiQuery({ name: 'kind', enum: PageKind, required: false })
  @ApiQuery({ name: 'locationId', required: false })
  @Get('pages')
  findAll(
    @Param('companyId') companyId: string,
    @CurrentUser() user: User,
    @Query('kind') kind?: PageKind,
    @Query('locationId') locationId?: string,
  ) {
    return this.pages.findAll(companyId, user.id, { kind, locationId });
  }

  @ApiOperation({ summary: 'Create a page (ADMIN+)' })
  @Post('pages')
  create(
    @Param('companyId') companyId: string,
    @CurrentUser() user: User,
    @Body() dto: CreatePageDto,
  ) {
    return this.pages.create(companyId, user.id, dto);
  }

  @ApiOperation({ summary: 'Get a single page' })
  @Get('pages/:id')
  findOne(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: User,
  ) {
    return this.pages.findOne(id, companyId, user.id);
  }

  @ApiOperation({ summary: 'Update a page (ADMIN+)' })
  @Patch('pages/:id')
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdatePageDto,
  ) {
    return this.pages.update(id, companyId, user.id, dto);
  }

  @ApiOperation({ summary: 'Delete a page (ADMIN+)' })
  @Delete('pages/:id')
  remove(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: User,
  ) {
    return this.pages.remove(id, companyId, user.id);
  }
}
