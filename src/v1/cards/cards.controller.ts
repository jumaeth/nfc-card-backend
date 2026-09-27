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
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CardsService } from './cards.service.js';
import { CreateCardDto } from './dto/create-card.dto.js';
import { UpdateCardDto } from './dto/update-card.dto.js';
import { SetDestinationDto } from './dto/set-destination.dto.js';
import { BetterAuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { User } from '../../../generated/prisma/client.js';

@ApiTags('cards')
@ApiBearerAuth()
@UseGuards(BetterAuthGuard)
@ApiParam({ name: 'companyId', description: 'The company that owns the cards.' })
@Controller('companies/:companyId')
export class CardsController {
  constructor(private readonly cards: CardsService) {}

  @ApiOperation({ summary: "List a company's cards" })
  @ApiQuery({ name: 'locationId', required: false, description: 'Filter to one location.' })
  @Get('cards')
  findAll(
    @Param('companyId') companyId: string,
    @CurrentUser() user: User,
    @Query('locationId') locationId?: string,
  ) {
    return this.cards.findAll(companyId, user.id, locationId);
  }

  @ApiOperation({ summary: 'Create a card' })
  @Post('cards')
  create(
    @Param('companyId') companyId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateCardDto,
  ) {
    return this.cards.create(companyId, user.id, dto);
  }

  @ApiOperation({ summary: 'Get a single card' })
  @Get('cards/:id')
  findOne(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: User,
  ) {
    return this.cards.findOne(id, companyId, user.id);
  }

  @ApiOperation({ summary: 'Update card metadata' })
  @Patch('cards/:id')
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateCardDto,
  ) {
    return this.cards.update(id, companyId, user.id, dto);
  }

  @ApiOperation({ summary: "Set or clear the card's tap destination" })
  @Put('cards/:id/destination')
  setDestination(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: SetDestinationDto,
  ) {
    return this.cards.setDestination(id, companyId, user.id, dto.pageId);
  }

  @ApiOperation({ summary: 'Delete a card' })
  @Delete('cards/:id')
  remove(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: User,
  ) {
    return this.cards.remove(id, companyId, user.id);
  }
}
