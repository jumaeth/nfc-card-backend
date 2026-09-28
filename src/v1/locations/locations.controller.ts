import { Controller, Get, Post, Patch, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { LocationsService } from './locations.service.js';
import { CreateLocationDto } from './dto/create-location.dto.js';
import { UpdateLocationDto } from './dto/update-location.dto.js';
import { SetActiveLocationsDto } from './dto/set-active-locations.dto.js';
import { BetterAuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { User } from '../../../generated/prisma/client.js';

@ApiTags('locations')
@ApiBearerAuth()
@UseGuards(BetterAuthGuard)
@Controller('companies/:companyId')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @ApiOperation({ summary: "List the company's locations" })
  @Get('locations')
  findAll(@Param('companyId') companyId: string, @CurrentUser() user: User) {
    return this.locations.findAll(companyId, user.id);
  }

  @ApiOperation({ summary: 'Create a location (ADMIN+)' })
  @Post('locations')
  create(
    @Param('companyId') companyId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateLocationDto,
  ) {
    return this.locations.create(companyId, user.id, dto);
  }

  @ApiOperation({ summary: 'Choose which locations stay editable over the plan limit (ADMIN+)' })
  @Put('locations/active')
  setActive(
    @Param('companyId') companyId: string,
    @CurrentUser() user: User,
    @Body() dto: SetActiveLocationsDto,
  ) {
    return this.locations.setActive(companyId, user.id, dto.locationIds);
  }

  @ApiOperation({ summary: 'Get a single location' })
  @Get('locations/:id')
  findOne(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: User,
  ) {
    return this.locations.findOne(id, companyId, user.id);
  }

  @ApiOperation({ summary: 'Update a location or set it as default (ADMIN+)' })
  @Patch('locations/:id')
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.locations.update(id, companyId, user.id, dto);
  }

  @ApiOperation({ summary: 'Delete a location (ADMIN+)' })
  @Delete('locations/:id')
  remove(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: User,
  ) {
    return this.locations.remove(id, companyId, user.id);
  }
}
