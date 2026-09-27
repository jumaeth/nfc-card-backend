import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  createHmac,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EmailService } from '../../email/email.service.js';
import { log, warn, LogKey } from '../../logger/index.js';
import { accessMode } from './wifi-content.js';
import type { WifiContent } from './wifi-content.js';
import { buildWifiProfile } from './wifi-profile.js';
import type {
  RequestWifiAccessDto,
  VerifyWifiAccessDto,
} from './dto/wifi-access.dto.js';

const CODE_TTL_MS = 10 * 60_000;
const CODE_RESEND_MS = 30_000;
const MAX_CODE_ATTEMPTS = 5;
/** A granted guest keeps access on that device this long without a new code. */
const TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;
/** Guests without marketing consent are deleted after this long without a visit. */
const RETENTION_MS = 365 * 24 * 60 * 60_000;

export type WifiAccessResult =
  | { status: 'granted'; token: string; password: string | null }
  | { status: 'code_sent'; email: string };

/**
 * The public side of Wi-Fi guest access. Guests have no session and no tenant
 * context, so every query uses the raw client and is scoped explicitly by the
 * published page's slug.
 */
@Injectable()
export class WifiAccessService {
  private readonly secret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    config: ConfigService,
  ) {
    this.secret = config.getOrThrow<string>('BETTER_AUTH_SECRET');
  }

  /** Step 1: the guest leaves their email. Grants access, or emails a code. */
  async requestAccess(
    slug: string,
    dto: RequestWifiAccessDto,
  ): Promise<WifiAccessResult> {
    const page = await this.requireWifiPage(slug);
    const mode = accessMode(page.wifi);
    if (mode === 'open')
      throw new BadRequestException('This network needs no email.');

    const email = dto.email.trim().toLowerCase();
    const locale = dto.locale ?? 'de';
    const now = new Date();
    // Consent only counts where the page actually asked for it. A later visit
    // without the tick does not withdraw it; guests withdraw via the business.
    const consent =
      page.wifi.guestAccess?.marketing === true &&
      dto.marketingConsent === true;

    const db = this.prisma.$prisma;
    await this.purgeExpired(page.companyId);

    const existing = await db.wifiGuest.findUnique({
      where: { pageId_email: { pageId: page.id, email } },
    });
    const guest = existing
      ? await db.wifiGuest.update({
          where: { id: existing.id },
          data: {
            locale,
            ...(consent &&
              !existing.marketingConsent && {
                marketingConsent: true,
                consentAt: now,
              }),
          },
        })
      : await db.wifiGuest.create({
          data: {
            companyId: page.companyId,
            pageId: page.id,
            email,
            locale,
            visits: 0,
            ...(consent && { marketingConsent: true, consentAt: now }),
          },
        });

    if (mode === 'email') {
      await db.wifiGuest.update({
        where: { id: guest.id },
        data: { visits: { increment: 1 }, lastSeenAt: now },
      });
      log(LogKey.WIFI_ACCESS_GRANTED, 'Wi-Fi access granted', {
        pageId: page.id,
        mode,
      });
      return this.granted(page.id, email, page.wifi);
    }

    // Verify mode: don't mail a new code while the last one is fresh.
    if (
      guest.codeSentAt &&
      now.getTime() - guest.codeSentAt.getTime() < CODE_RESEND_MS
    ) {
      return { status: 'code_sent', email };
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await db.wifiGuest.update({
      where: { id: guest.id },
      data: {
        codeHash: this.hashCode(guest.id, code),
        codeExpiresAt: new Date(now.getTime() + CODE_TTL_MS),
        codeSentAt: now,
        codeAttempts: 0,
      },
    });
    await this.email.sendWifiCodeEmail(email, {
      code,
      businessName: page.businessName,
      ssid: page.wifi.ssid ?? '',
      locale,
    });
    log(LogKey.WIFI_CODE_SENT, 'Wi-Fi code sent', { pageId: page.id });
    return { status: 'code_sent', email };
  }

  /** Step 2 (verify mode): the guest enters the emailed code. */
  async verify(
    slug: string,
    dto: VerifyWifiAccessDto,
  ): Promise<WifiAccessResult> {
    const page = await this.requireWifiPage(slug);
    if (accessMode(page.wifi) !== 'verify') {
      throw new BadRequestException('This network needs no code.');
    }
    const email = dto.email.trim().toLowerCase();
    const db = this.prisma.$prisma;
    const guest = await db.wifiGuest.findUnique({
      where: { pageId_email: { pageId: page.id, email } },
    });
    const invalid = () =>
      new BadRequestException('The code is wrong or has expired.');
    if (
      !guest?.codeHash ||
      !guest.codeExpiresAt ||
      guest.codeExpiresAt < new Date()
    ) {
      throw invalid();
    }
    if (guest.codeAttempts >= MAX_CODE_ATTEMPTS) {
      throw new BadRequestException('Too many attempts. Request a new code.');
    }
    if (!this.safeEqual(guest.codeHash, this.hashCode(guest.id, dto.code))) {
      await db.wifiGuest.update({
        where: { id: guest.id },
        data: { codeAttempts: { increment: 1 } },
      });
      warn(LogKey.WIFI_CODE_FAILED, 'Wrong Wi-Fi code', { pageId: page.id });
      throw invalid();
    }

    const now = new Date();
    await db.wifiGuest.update({
      where: { id: guest.id },
      data: {
        verified: true,
        verifiedAt: guest.verifiedAt ?? now,
        codeHash: null,
        codeExpiresAt: null,
        codeAttempts: 0,
        visits: { increment: 1 },
        lastSeenAt: now,
      },
    });
    log(LogKey.WIFI_ACCESS_GRANTED, 'Wi-Fi access granted', {
      pageId: page.id,
      mode: 'verify',
    });
    return this.granted(page.id, email, page.wifi);
  }

  /** A returning guest on the same device: the stored token replaces the form. */
  async credentials(slug: string, token: string | undefined) {
    const page = await this.requireWifiPage(slug);
    const email = this.readToken(token, page.id);
    await this.prisma.$prisma.wifiGuest.updateMany({
      where: { pageId: page.id, email },
      data: { visits: { increment: 1 }, lastSeenAt: new Date() },
    });
    return { password: this.password(page.wifi) };
  }

  /** The iOS profile. With guest access on, only for a granted guest. */
  async profile(slug: string, token: string | undefined): Promise<string> {
    const page = await this.requireWifiPage(slug);
    if (accessMode(page.wifi) !== 'open') this.readToken(token, page.id);
    return buildWifiProfile({
      pageId: page.id,
      businessName: page.businessName,
      wifi: page.wifi,
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private async requireWifiPage(slug: string) {
    const page = await this.prisma.$prisma.page.findUnique({
      where: { slug },
      include: { company: { select: { name: true } } },
    });
    const wifi = page?.content as WifiContent | null | undefined;
    if (
      !page ||
      page.deletedAt ||
      !page.published ||
      page.kind !== 'WIFI' ||
      !wifi?.ssid
    ) {
      throw new NotFoundException('Page not found');
    }
    return {
      id: page.id,
      companyId: page.companyId,
      businessName: page.company.name,
      wifi,
    };
  }

  private password(wifi: WifiContent): string | null {
    return wifi.encryption === 'nopass' ? null : (wifi.password ?? null);
  }

  private granted(
    pageId: string,
    email: string,
    wifi: WifiContent,
  ): WifiAccessResult {
    return {
      status: 'granted',
      token: this.signToken(pageId, email),
      password: this.password(wifi),
    };
  }

  /** Data minimisation: drop guests who never opted in and stopped coming. */
  private async purgeExpired(companyId: string) {
    await this.prisma.$prisma.wifiGuest.deleteMany({
      where: {
        companyId,
        marketingConsent: false,
        lastSeenAt: { lt: new Date(Date.now() - RETENTION_MS) },
      },
    });
  }

  private hashCode(guestId: string, code: string): string {
    return createHash('sha256')
      .update(`${this.secret}:${guestId}:${code}`)
      .digest('hex');
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret)
      .update(`wifi:${payload}`)
      .digest('base64url');
  }

  private signToken(pageId: string, email: string): string {
    const payload = Buffer.from(
      JSON.stringify({ p: pageId, e: email, x: Date.now() + TOKEN_TTL_MS }),
    ).toString('base64url');
    return `${payload}.${this.sign(payload)}`;
  }

  /** Returns the guest's email when the token is valid for this page. */
  private readToken(token: string | undefined, pageId: string): string {
    const denied = new UnauthorizedException(
      'Wi-Fi access has expired. Please sign in again.',
    );
    const [payload, signature] = (token ?? '').split('.');
    if (
      !payload ||
      !signature ||
      !this.safeEqual(signature, this.sign(payload))
    )
      throw denied;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
        p?: string;
        e?: string;
        x?: number;
      };
      if (data.p !== pageId || !data.e || !data.x || data.x < Date.now())
        throw denied;
      return data.e;
    } catch {
      throw denied;
    }
  }

  private safeEqual(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  }
}
