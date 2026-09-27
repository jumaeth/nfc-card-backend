import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { BetterAuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { CompanyAccessService } from '../companies/company-access.service.js';
import type { User } from '../../../generated/prisma/client.js';
import { StorageService } from './storage.service.js';
import {
  COMPANY_ID_PATTERN,
  FILE_NAME_PATTERN,
  MIME_BY_EXT,
  UploadsService,
} from './uploads.service.js';

@ApiTags('uploads')
@ApiBearerAuth()
@UseGuards(BetterAuthGuard)
@Controller('companies/:companyId/uploads')
export class UploadsController {
  constructor(
    private readonly uploads: UploadsService,
    private readonly access: CompanyAccessService,
  ) {}

  @ApiOperation({
    summary:
      'Upload an image for page designs (ADMIN+). Send the raw bytes, max 5 MB.',
  })
  @ApiConsumes('image/png', 'image/jpeg', 'image/webp', 'image/gif')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post()
  async upload(
    @Param('companyId') companyId: string,
    @CurrentUser() user: User,
    @Req() req: Request,
  ) {
    // Same bar as editing a page.
    await this.access.requireManager(user.id, companyId);
    return this.uploads.uploadImage(companyId, req, { userId: user.id });
  }
}

// Unauthenticated: uploaded images are shown on public tap pages.
@ApiTags('files')
@SkipThrottle()
@Controller('files')
export class FilesController {
  constructor(private readonly storage: StorageService) {}

  @ApiOperation({ summary: 'Serve an uploaded image' })
  @Get('companies/:companyId/:file')
  async serve(
    @Param('companyId') companyId: string,
    @Param('file') file: string,
    @Res() res: Response,
  ) {
    if (!COMPANY_ID_PATTERN.test(companyId) || !FILE_NAME_PATTERN.test(file)) {
      throw new NotFoundException();
    }
    const key = `companies/${companyId}/${file}`;

    // Bucket: hand the browser a short-lived direct link (bucket egress is free).
    if (this.storage.isBucket) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.redirect(302, await this.storage.presignedUrl(key));
    }

    const bytes = await this.storage.readLocal(key);
    if (!bytes) throw new NotFoundException();
    res.setHeader('Content-Type', MIME_BY_EXT[file.split('.').pop()!]);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(bytes);
  }
}
