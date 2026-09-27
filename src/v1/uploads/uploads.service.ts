import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { customAlphabet } from 'nanoid';
import { StorageService } from './storage.service.js';
import { log, LogKey } from '../../logger/index.js';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const fileId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 20);

// Raster images only, recognised by their magic bytes (never by the client's
// Content-Type). SVG is refused: it can carry script.
const IMAGE_TYPES = [
  {
    ext: 'png',
    mime: 'image/png',
    test: (b: Buffer) => b.subarray(0, 4).toString('hex') === '89504e47',
  },
  {
    ext: 'jpg',
    mime: 'image/jpeg',
    test: (b: Buffer) => b.subarray(0, 3).toString('hex') === 'ffd8ff',
  },
  {
    ext: 'gif',
    mime: 'image/gif',
    test: (b: Buffer) => b.subarray(0, 4).toString('ascii') === 'GIF8',
  },
  {
    ext: 'webp',
    mime: 'image/webp',
    test: (b: Buffer) =>
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
] as const;

export const MIME_BY_EXT: Record<string, string> = Object.fromEntries(
  IMAGE_TYPES.map((t) => [t.ext, t.mime]),
);

/** Company ids are cuids; file names are our own ids. Nothing else is served. */
export const FILE_NAME_PATTERN = /^[a-z0-9]{20}\.(png|jpg|gif|webp)$/;
export const COMPANY_ID_PATTERN = /^[a-z0-9]{20,40}$/;

/**
 * Stores images for page designs (logos, covers, menu photos). Callers
 * authorize the company first; this only validates and stores the bytes.
 */
@Injectable()
export class UploadsService {
  private readonly apiUrl: string;

  constructor(
    config: ConfigService,
    private readonly storage: StorageService,
  ) {
    // Base URL of this API; file URLs are stored in page themes and content.
    this.apiUrl = config
      .get<string>('BETTER_AUTH_URL', 'http://localhost:3311')
      .replace(/\/$/, '');
  }

  async uploadImage(
    companyId: string,
    req: Request,
    meta: Record<string, unknown>,
  ) {
    const body = await readBody(req, MAX_UPLOAD_BYTES);
    if (body.length === 0) throw new BadRequestException('The file is empty');

    const type = IMAGE_TYPES.find((t) => t.test(body));
    if (!type)
      throw new UnsupportedMediaTypeException(
        'Upload a PNG, JPG, WebP or GIF image',
      );

    const key = `companies/${companyId}/${fileId()}.${type.ext}`;
    await this.storage.put(key, body, type.mime);
    log(LogKey.UPLOAD_STORED, 'Image uploaded', {
      companyId,
      key,
      bytes: body.length,
      ...meta,
    });
    return { url: `${this.apiUrl}/api/v1/files/${key}` };
  }
}

/** Read the raw request body, refusing anything over `max` bytes. */
function readBody(req: Request, max: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > max) return Promise.reject(tooLarge());

  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        req.destroy();
        reject(tooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function tooLarge() {
  return new PayloadTooLargeException(
    `Images can be at most ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`,
  );
}
