import { SetMetadata } from '@nestjs/common';
import type { PlatformRole } from '../../../../generated/prisma/enums.js';

/**
 * Restricts a route to platform staff at or above the given `PlatformRole` on
 * the staff ladder (USER < SUPPORT < ADMIN < SUPER_ADMIN). The listed role is a
 * MINIMUM, so `@PlatformRoles('ADMIN')` also admits `SUPER_ADMIN`. Enforced by
 * `PlatformRoleGuard`, which must run after `BetterAuthGuard` (it reads
 * `request.user`). Set at the controller level as a default (SUPPORT) and
 * overridden per route for the actions that need a higher tier.
 */
export const PLATFORM_ROLES = 'platformRoles';
export const PlatformRoles = (...roles: PlatformRole[]) =>
  SetMetadata(PLATFORM_ROLES, roles);
