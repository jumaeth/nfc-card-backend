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

  @ApiOperation({ summary: 'Resolve a card link /c/<company>/<card> to its tap destination' })
  @Get('cards/:company/:card')
  resolveCard(
    @Param('company') company: string,
    @Param('card') card: string,
    @Req() req: Request,
  ) {
    return this.publicService.resolveCard(company, card, req);
  }

  @ApiOperation({ summary: 'Resolve an old-style card link /c/<slug> (cards made before per-company links)' })
  @Get('cards/:slug')
  resolveLegacyCard(@Param('slug') slug: string, @Req() req: Request) {
    return this.publicService.resolveLegacyCard(slug, req);
  }

  @ApiOperation({ summary: 'Resolve a shared page slug directly' })
  @Get('pages/:slug')
  resolvePage(@Param('slug') slug: string, @Req() req: Request) {
    return this.publicService.resolvePage(slug, req);
  }
}
