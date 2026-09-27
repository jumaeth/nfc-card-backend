import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import { BetterAuthService } from './better-auth.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { setTenantUserId } from '../../prisma/tenant-context.js';
import { SKIP_PASSKEY_GATE } from './decorators/skip-passkey-gate.decorator.js';
import { PLATFORM_ROLES } from './decorators/platform-roles.decorator.js';
import {
  PRIVILEGED_ROLES,
  passkeyEnforcementEnabled,
  PASSKEY_REQUIRED_CODE,
} from '../../common/permissions.js';
import type { User } from '../../../generated/prisma/client.js';

/**
 * How long a validated session (session + resolved User) is reused from memory
 * before re-validating against the database. A screen load fires many requests
 * with the same bearer token; caching collapses that burst to one validation.
 * Kept short so a revoked session stops working within seconds.
 */
const SESSION_CACHE_TTL_MS = 10_000;
const SESSION_CACHE_MAX = 10_000;

type Session = NonNullable<
  Awaited<ReturnType<BetterAuthService['api']['getSession']>>
>;

type CachedAuth = { session: Session; user: User; expiresAt: number };

const sessionCache = new Map<string, CachedAuth>();

function pruneSessionCache(now: number): void {
  for (const [token, entry] of sessionCache) {
    if (entry.expiresAt <= now) sessionCache.delete(token);
  }
  if (sessionCache.size >= SESSION_CACHE_MAX) {
    const overflow = sessionCache.size - SESSION_CACHE_MAX + 1;
    let removed = 0;
    for (const token of sessionCache.keys()) {
      sessionCache.delete(token);
      if (++removed >= overflow) break;
    }
  }
}

function isPlatformRoute(context: ExecutionContext, reflector: Reflector): boolean {
  const roles = reflector.getAllAndOverride<unknown[]>(PLATFORM_ROLES, [
    context.getHandler(),
    context.getClass(),
  ]);
  return Array.isArray(roles) && roles.length > 0;
}

/** Drops a token from the session cache — called on sign-out so a revoked bearer
 *  token stops authenticating immediately. */
export function invalidateSessionToken(token: string): void {
  sessionCache.delete(token);
}

function bearerToken(headers: IncomingHttpHeaders): string | null {
  const raw = headers['authorization'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1] : null;
}

@Injectable()
export class BetterAuthGuard implements CanActivate {
  constructor(
    private readonly betterAuthService: BetterAuthService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const { session, user } = await this.resolveAuth(request, context);
    request.user = user;
    request.session = session.session;
    // Establish the tenant context: every RLS query now runs as this user,
    // seeing only companies they belong to.
    setTenantUserId(user.id);

    await this.enforcePasskey(context, request, user.id);
    return true;
  }

  private async resolveAuth(
    request: { headers: IncomingHttpHeaders },
    context: ExecutionContext,
  ): Promise<{ session: Session; user: User }> {
    const token = bearerToken(request.headers);
    const now = Date.now();

    const cacheable =
      token !== null && !request.headers.cookie && !isPlatformRoute(context, this.reflector);

    if (cacheable) {
      const hit = sessionCache.get(token);
      if (hit && hit.expiresAt > now) {
        return { session: hit.session, user: hit.user };
      }
    }

    const session = await this.betterAuthService.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });
    if (!session) throw new UnauthorizedException();
    const user = await this.prisma.user.findUnique({ where: { id: session.user.id } });
    if (!user) throw new UnauthorizedException();

    if (cacheable && (session.session as { token?: string }).token === token) {
      if (sessionCache.size >= SESSION_CACHE_MAX) pruneSessionCache(now);
      sessionCache.set(token, { session, user, expiresAt: now + SESSION_CACHE_TTL_MS });
    }
    return { session, user };
  }

  /**
   * Require a passkey-authenticated session where policy demands it, rejecting a
   * password/Google session with 403 `PASSKEY_REQUIRED` so the app can route the
   * user through passkey step-up. Gated behind the global rollout switch and
   * applied to anyone holding a privileged role (OWNER/ADMIN) in ANY company —
   * derived from their own memberships, never a client-supplied companyId.
   * Endpoints marked `@SkipPasskeyGate()` are exempt (bootstrap/discovery).
   */
  private async enforcePasskey(
    context: ExecutionContext,
    request: { session?: { authMethod?: string | null } },
    userId: string,
  ): Promise<void> {
    if (request.session?.authMethod === 'passkey') return;
    if (!passkeyEnforcementEnabled(this.config)) return;

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_PASSKEY_GATE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return;

    if (await this.isPrivilegedAnywhere(userId)) {
      throw new ForbiddenException({
        code: PASSKEY_REQUIRED_CODE,
        message: 'A passkey is required for your role. Please sign in with your passkey.',
      });
    }
  }

  private async isPrivilegedAnywhere(userId: string): Promise<boolean> {
    const member = await this.prisma.companyMember.findFirst({
      where: { userId, role: { in: PRIVILEGED_ROLES }, removedAt: null },
      select: { id: true },
    });
    return member !== null;
  }
}
