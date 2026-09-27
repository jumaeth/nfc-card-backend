import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request tenant context. Carries the authenticated user's id through the
 * async call chain so the Prisma layer can stamp it onto every DB connection as
 * the `app.current_user_id` session variable that RLS policies read.
 *
 * Keyed on the USER (not a client-supplied companyId) on purpose: the user id
 * comes straight from the validated session and cannot be spoofed, and the RLS
 * policies resolve which companies that user may touch via `CompanyMember`. So
 * even a buggy query that forgets `companyId` can only ever see the caller's own
 * tenants — the database enforces it.
 *
 * Uses Node's built-in AsyncLocalStorage rather than a dependency; the store is
 * established once per request by TenantContextMiddleware and populated by
 * BetterAuthGuard after the session is validated.
 */
type TenantStore = { userId?: string };

const storage = new AsyncLocalStorage<TenantStore>();

/** Runs `fn` inside a fresh tenant-context store. Wrap the whole request in this. */
export function runWithTenantContext<T>(fn: () => T): T {
  return storage.run({}, fn);
}

/** Sets the authenticated user id for the current request (called by the guard). */
export function setTenantUserId(userId: string): void {
  const store = storage.getStore();
  if (store) store.userId = userId;
}

/**
 * The authenticated user id for the current request, or undefined if there is no
 * context (unauthenticated route, or a call made outside a request). When
 * undefined, RLS receives no user and fails closed — every policied table
 * returns zero rows.
 */
export function getTenantUserId(): string | undefined {
  return storage.getStore()?.userId;
}
