import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { log, warn, LogKey } from '../../logger/index.js';

// Presigned links outlive the redirect's cache time, so a cached redirect never
// points at an expired link.
const PRESIGN_SECONDS = 2 * 60 * 60;

/**
 * Where uploaded files live. A Railway storage bucket (S3-compatible, private)
 * when BUCKET_* is configured; outside production, a local `.uploads` folder so
 * uploads work without any setup. Production without a bucket refuses uploads.
 */
@Injectable()
export class StorageService {
  private readonly s3?: S3Client;
  private readonly bucket?: string;
  private readonly localDir?: string;

  constructor(config: ConfigService) {
    const bucket = config.get<string>('BUCKET_NAME');
    const endpoint = config.get<string>('BUCKET_ENDPOINT');
    const accessKeyId = config.get<string>('BUCKET_ACCESS_KEY_ID');
    const secretAccessKey = config.get<string>('BUCKET_SECRET_ACCESS_KEY');

    if (bucket && endpoint && accessKeyId && secretAccessKey) {
      this.bucket = bucket;
      this.s3 = new S3Client({
        endpoint,
        region: config.get<string>('BUCKET_REGION', 'auto'),
        credentials: { accessKeyId, secretAccessKey },
        // Older Railway buckets need path-style URLs (see the bucket's Credentials tab).
        forcePathStyle:
          config.get<string>('BUCKET_FORCE_PATH_STYLE') === 'true',
      });
      log(LogKey.STORAGE_READY, 'Bucket storage initialised', { bucket });
    } else if (config.get<string>('NODE_ENV') !== 'production') {
      this.localDir = resolve('.uploads');
      log(LogKey.STORAGE_READY, 'Local file storage initialised', {
        dir: this.localDir,
      });
    } else {
      warn(
        LogKey.STORAGE_NOT_CONFIGURED,
        'BUCKET_* not set, uploads are disabled',
      );
    }
  }

  get isBucket() {
    return !!this.s3;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    if (this.s3) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      return;
    }
    if (this.localDir) {
      const path = join(this.localDir, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
      return;
    }
    throw new ServiceUnavailableException(
      'Uploads are not available right now',
    );
  }

  /** A short-lived direct link to a bucket object (bucket mode only). */
  presignedUrl(key: string): Promise<string> {
    if (!this.s3)
      throw new ServiceUnavailableException(
        'Files are not available right now',
      );
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      {
        expiresIn: PRESIGN_SECONDS,
      },
    );
  }

  /** The file's bytes (local mode only). Null when missing. */
  async readLocal(key: string): Promise<Buffer | null> {
    if (!this.localDir) return null;
    return readFile(join(this.localDir, key)).catch(() => null);
  }
}
