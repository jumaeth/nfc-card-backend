import type {
  CompanyRole,
  Permission,
  PlatformRole,
} from '../../generated/prisma/client.js';

// Permissions granted to a role by default. Layered on top of any explicit
// per-member grants.
export const DEFAULT_ROLE_PERMISSIONS: Record<CompanyRole, Permission[]> = {
  OWNER: ['MANAGE_CARDS', 'MANAGE_BILLING'],
  ADMIN: ['MANAGE_CARDS'],
  MEMBER: [],
};

export function hasPermission(
  member: { role: CompanyRole; permissions: Permission[] },
  permission: Permission,
): boolean {
  return (
    DEFAULT_ROLE_PERMISSIONS[member.role].includes(permission) ||
    member.permissions.includes(permission)
  );
}

// Higher number = more privileged.
export const ROLE_RANK: Record<CompanyRole, number> = {
  MEMBER: 0,
  ADMIN: 1,
  OWNER: 2,
};

/** Roles allowed to manage tenant resources (cards, pages, locations). */
export const ADMIN_ROLES: CompanyRole[] = ['ADMIN', 'OWNER'];

/** Whether `requesterRole` may manage a member with `targetRole`. */
export function canManageRole(
  requesterRole: CompanyRole,
  targetRole: CompanyRole,
): boolean {
  return ROLE_RANK[requesterRole] >= ROLE_RANK[targetRole];
}

// ─── Platform (staff) roles ──────────────────────────────────────────────────

// Gating ladder for staff routes (`@PlatformRoles` is a minimum). SALES sits
// lowest: it can reach the admin console but only ever sees its own customers.
export const PLATFORM_ROLE_RANK: Record<PlatformRole, number> = {
  USER: 0,
  SALES: 1,
  SUPPORT: 2,
  ADMIN: 3,
  SUPER_ADMIN: 4,
};

export const STAFF_PLATFORM_ROLES: PlatformRole[] = ['SALES', 'SUPPORT', 'ADMIN', 'SUPER_ADMIN'];

export function platformRoleAtLeast(role: PlatformRole, minimum: PlatformRole): boolean {
  return PLATFORM_ROLE_RANK[role] >= PLATFORM_ROLE_RANK[minimum];
}

/** Staff who see every customer (SALES only sees the ones assigned to them). */
export function seesAllCustomers(role: PlatformRole): boolean {
  return platformRoleAtLeast(role, 'SUPPORT');
}

/**
 * Whether a staff member may change a customer. ADMIN+ may change any customer,
 * SALES only its own, SUPPORT is read-only.
 */
export function canManageCustomer(
  staff: { id: string; platformRole: PlatformRole },
  company: { salesRepId: string | null },
): boolean {
  if (platformRoleAtLeast(staff.platformRole, 'ADMIN')) return true;
  return staff.platformRole === 'SALES' && company.salesRepId === staff.id;
}

// ─── Passkey enforcement ─────────────────────────────────────────────────────

/** Privileged tenant roles that must hold a passkey session once enforcement is
 *  on (OWNER/ADMIN). MEMBER may stay on password/Google. */
export const PRIVILEGED_ROLES: CompanyRole[] = ['ADMIN', 'OWNER'];

/** Error code returned when a privileged action needs a passkey-verified session. */
export const PASSKEY_REQUIRED_CODE = 'PASSKEY_REQUIRED';

/**
 * Whether privileged-role passkey enforcement is active. Off by default so the
 * backend can ship ahead of the app's passkey setup/step-up screens.
 */
export function passkeyEnforcementEnabled(config: {
  get(key: string): string | undefined;
}): boolean {
  return (config.get('PASSKEY_ENFORCEMENT') ?? '').trim().toLowerCase() === 'true';
}

/**
 * Session auth methods permitted to enroll a passkey. `passkey` (already strong)
 * or `email-otp` (proved email possession) — never `password`/`google` alone.
 */
export const PASSKEY_ENROLL_METHODS = ['passkey', 'email-otp'];
