import { Controller, Get, Param, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PublicService } from './public.service.js';

// Unauthenticated. Serves the public "tap" resolution for cards and shared
// pages, and records coarse, anonymised analytics. No guard, no tenant context.
@ApiTags('public')
@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @ApiOperation({ summary: 'Resolve a card slug to its live tap destination' })
  @Get('cards/:slug')
  resolveCard(@Param('slug') slug: string, @Req() req: Request) {
    return this.publicService.resolveCard(slug, req);
  }

  @ApiOperation({ summary: 'Resolve a shared page slug directly' })
  @Get('pages/:slug')
  resolvePage(@Param('slug') slug: string, @Req() req: Request) {
    return this.publicService.resolvePage(slug, req);
  }
}
