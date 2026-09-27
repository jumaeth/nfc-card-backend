import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PLATFORM_ROLES } from './decorators/platform-roles.decorator.js';
import { platformRoleAtLeast } from '../../common/permissions.js';
import type { PlatformRole, User } from '../../../generated/prisma/client.js';

/**
 * Enforces `@PlatformRoles(minimum)`. Must run after `BetterAuthGuard`, which
 * resolves `request.user` (uncached on platform routes, so a role change takes
 * effect on the next request). Routes without the metadata are left alone.
 */
@Injectable()
export class PlatformRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<PlatformRole[] | undefined>(PLATFORM_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;

    const user = context.switchToHttp().getRequest<{ user?: User }>().user;
    if (!user || user.deletedAt) throw new ForbiddenException('Staff access required');

    if (!roles.some((minimum) => platformRoleAtLeast(user.platformRole, minimum))) {
      throw new ForbiddenException('Your staff role does not allow this action');
    }
    return true;
  }
}
