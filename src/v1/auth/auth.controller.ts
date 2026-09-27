import { All, Controller, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { BetterAuthService } from './better-auth.service.js';
import { invalidateSessionToken } from './auth.guard.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  passkeyEnforcementEnabled,
  PASSKEY_ENROLL_METHODS,
  PRIVILEGED_ROLES,
} from '../../common/permissions.js';
import { log, warn, LogKey } from '../../logger/index.js';

// better-auth passkey registration endpoints (relative to the auth base path).
const PASSKEY_REGISTER_PATHS = [
  '/passkey/generate-register-options',
  '/passkey/verify-registration',
];

@Controller('auth')
export class AuthController {
  constructor(
    private readonly betterAuthService: BetterAuthService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @All('*')
  async handleAuth(@Req() req: Request, @Res() res: Response) {
    // Ensure better-auth sees the full URL regardless of Express path stripping
    req.url = req.originalUrl;

    // Enrollment authorization gate: a privileged user (OWNER/ADMIN/MANAGER in
    // any company) may only enroll a passkey from a session that already proved a
    // strong factor — an existing passkey or a fresh email-OTP. This is what makes
    // "force passkeys for admins" meaningful: a stolen password alone can log in
    // but cannot self-enroll a passkey (it would need the user's email too).
    if (PASSKEY_REGISTER_PATHS.some((p) => req.originalUrl.includes(p))) {
      const blocked = await this.blockUnauthorizedPasskeyEnrollment(req);
      if (blocked) {
        res.status(403).json({
          code: 'PASSKEY_ENROLL_UNAUTHORIZED',
          message: 'Verify your email before setting up a passkey.',
        });
        return;
      }
    }

    const startedAt = Date.now();
    const chunks: Buffer[] = [];
    const origEnd = res.end.bind(res);

    const collect = (chunk: any) => {
      if (chunk != null && typeof chunk !== 'function') chunks.push(Buffer.from(chunk));
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res.write = ((chunk: any) => {
      collect(chunk);
      return true;
    }) as any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res.end = ((chunk: any, ...args: any[]) => {
      collect(chunk);

      let finalBody = Buffer.concat(chunks);

      // On a successful sign-out, evict this token from the guard's session cache
      // so the revoked bearer stops authenticating immediately rather than after
      // the cache TTL.
      if (res.statusCode < 400 && req.originalUrl.includes('/sign-out')) {
        const auth = req.headers.authorization;
        const match = /^Bearer\s+(.+)$/i.exec((auth ?? '').trim());
        if (match) invalidateSessionToken(match[1]);
      }

      if (res.statusCode === 403) {
        try {
          const parsed = JSON.parse(finalBody.toString('utf8')) as Record<string, unknown>;
          if (parsed.code === 'EMAIL_NOT_VERIFIED') {
            finalBody = Buffer.from(JSON.stringify({ ...parsed, emailSent: true }));
            res.setHeader('Content-Length', finalBody.length);
          }
        } catch {}
      }

      const meta: Record<string, unknown> = {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        origin: req.headers.origin ?? null,
        callbackURL: (req.body as { callbackURL?: string } | undefined)?.callbackURL ?? null,
        ua: req.headers['user-agent'] ?? null,
        ip: req.ip ?? null,
        ms: Date.now() - startedAt,
      };
      if (res.statusCode >= 400) {
        // This is the response body (better-auth's error payload), not the
        // request — but redact credential-ish fields defensively in case an
        // error response ever echoes a submitted value back.
        const safeBody = finalBody
          .toString('utf8')
          .slice(0, 500)
          .replace(
            /("(?:password|newPassword|currentPassword|otp|token)"\s*:\s*)"[^"]*"/gi,
            '$1"[redacted]"',
          );
        warn(LogKey.AUTH_REQUEST, 'Auth request failed', {
          ...meta,
          body: safeBody,
        });
      } else {
        log(LogKey.AUTH_REQUEST, 'Auth request', meta);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (origEnd as any)(finalBody, ...args);
    }) as any;

    return toNodeHandler(this.betterAuthService.handler)(req, res);
  }

  /**
   * True if this passkey-registration request must be blocked: the caller is
   * privileged somewhere but their session did not prove a strong factor
   * (`passkey` or `email-otp`). Non-privileged users and already-strong sessions
   * are allowed through. Absence of a session is left to better-auth to reject.
   */
  private async blockUnauthorizedPasskeyEnrollment(req: Request): Promise<boolean> {
    if (!passkeyEnforcementEnabled(this.config)) return false;

    const session = await this.betterAuthService.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session) return false;

    const authMethod = (session.session as { authMethod?: string | null })?.authMethod;
    if (PASSKEY_ENROLL_METHODS.includes(authMethod ?? '')) return false;

    // This path has no RLS tenant context (it's the better-auth catch-all, not
    // behind BetterAuthGuard), so use the raw client and scope explicitly to the
    // authenticated user's own memberships.
    const privilegedCount = await this.prisma.$prisma.companyMember.count({
      where: { userId: session.user.id, role: { in: PRIVILEGED_ROLES }, removedAt: null },
    });
    return privilegedCount > 0;
  }
}
