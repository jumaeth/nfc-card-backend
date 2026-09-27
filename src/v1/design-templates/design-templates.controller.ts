import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BetterAuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { User } from '../../../generated/prisma/client.js';
import { DesignTemplatesService } from './design-templates.service.js';
import {
  CreateDesignTemplateDto,
  UpdateDesignTemplateDto,
} from './dto/design-template.dto.js';

@ApiTags('design-templates')
@ApiBearerAuth()
@UseGuards(BetterAuthGuard)
@Controller('companies/:companyId/design-templates')
export class DesignTemplatesController {
  constructor(private readonly templates: DesignTemplatesService) {}

  @ApiOperation({ summary: "List the company's saved page designs" })
  @Get()
  list(@Param('companyId') companyId: string, @CurrentUser() user: User) {
    return this.templates.list(companyId, user.id);
  }

  @ApiOperation({ summary: 'Save a page design as a template (ADMIN+)' })
  @Post()
  create(
    @Param('companyId') companyId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateDesignTemplateDto,
  ) {
    return this.templates.create(companyId, user.id, dto);
  }

  @ApiOperation({ summary: 'Rename or overwrite a saved design (ADMIN+)' })
  @Patch(':id')
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateDesignTemplateDto,
  ) {
    return this.templates.update(companyId, user.id, id, dto);
  }

  @ApiOperation({
    summary: 'Delete a saved design (ADMIN+). Pages keep their look.',
  })
  @HttpCode(204)
  @Delete(':id')
  remove(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: User,
  ) {
    return this.templates.remove(companyId, user.id, id);
  }
}
