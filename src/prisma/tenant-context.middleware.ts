import type { Request, Response, NextFunction } from 'express';
import { runWithTenantContext } from './tenant-context.js';

/**
 * Establishes a fresh tenant-context store for every request, so anything
 * downstream (the auth guard, controllers, services, Prisma) runs inside it.
 * The store starts empty; BetterAuthGuard fills in the user id once the session
 * is validated. Wrapping `next()` keeps the whole async request chain within the
 * same AsyncLocalStorage context.
 *
 * Registered as a plain global middleware in main.ts (`app.use`) rather than via
 * MiddlewareConsumer.forRoutes('*') — under Express 5 the bare '*' route pattern
 * throws, and this must run on literally every request anyway.
 */
export function tenantContextMiddleware(
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  runWithTenantContext(() => next());
}
